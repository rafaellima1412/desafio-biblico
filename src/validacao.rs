// src/validacao.rs
// Valida data/combos.json (e opcionalmente trilhas.json) ANTES do servidor subir.
// Resolve o grafo de forma ITERATIVA (sem recursão), então nunca estoura a pilha,
// mesmo que o JSON tenha ciclo. Se houver erro, o servidor recusa iniciar.

use serde::Deserialize;
use std::collections::{HashMap, HashSet};

#[derive(Deserialize)]
pub struct Combo {
    pub id: u32,
    pub combo: [String; 2],
    pub result: String,
    pub tier: u32,
}

#[derive(Deserialize)]
pub struct ComboFile {
    pub elementos_base: Vec<String>,
    pub combinacoes: Vec<Combo>,
}

#[derive(Deserialize)]
pub struct Trilha {
    pub id: String,
    pub elementos: Vec<String>,
}

#[derive(Deserialize)]
pub struct TrilhaFile {
    pub trilhas: Vec<Trilha>,
}

/// Retorna o tier calculado de cada elemento alcançável (base = 0),
/// ou a lista de erros encontrados.
pub fn validar(data: &ComboFile, trilhas: Option<&TrilhaFile>) -> Result<HashMap<String, u32>, Vec<String>> {
    let mut erros = Vec::new();

    // 1) Par repetido (A+B levando a dois resultados diferentes)
    let mut pares: HashMap<(String, String), u32> = HashMap::new();
    for c in &data.combinacoes {
        let mut k = [c.combo[0].clone(), c.combo[1].clone()];
        k.sort();
        if let Some(outro) = pares.insert((k[0].clone(), k[1].clone()), c.id) {
            erros.push(format!("par [{} + {}] repetido nos ids {} e {}", k[0], k[1], outro, c.id));
        }
    }

    // 2) Resolução iterativa a partir dos elementos base (tipo Kahn / ponto fixo)
    let mut nivel: HashMap<String, u32> =
        data.elementos_base.iter().map(|e| (e.clone(), 0)).collect();
    let mut pendentes: Vec<&Combo> = data.combinacoes.iter().collect();

    loop {
        let antes = pendentes.len();
        pendentes.retain(|c| match (nivel.get(&c.combo[0]), nivel.get(&c.combo[1])) {
            (Some(&a), Some(&b)) => {
                nivel.entry(c.result.clone()).or_insert(a.max(b) + 1);
                false // resolvido, sai da lista
            }
            _ => true,
        });
        if pendentes.len() == antes {
            break; // nada novo nesta passada: ponto fixo atingido
        }
    }

    // 3) O que sobrou é inalcançável: ingrediente órfão ou ciclo
    let produziveis: HashSet<&String> = data
        .combinacoes
        .iter()
        .map(|c| &c.result)
        .chain(data.elementos_base.iter())
        .collect();

    for c in &pendentes {
        let faltando: Vec<&String> = c.combo.iter().filter(|x| !nivel.contains_key(*x)).collect();
        let orfaos: Vec<&&String> = faltando.iter().filter(|x| !produziveis.contains(**x)).collect();
        if !orfaos.is_empty() {
            erros.push(format!(
                "id {} -> '{}': ingrediente {:?} não é base nem resultado de nenhuma combinação",
                c.id, c.result, orfaos
            ));
        } else {
            erros.push(format!(
                "id {} -> '{}': inalcançável, depende de {:?} (ciclo ou cadeia quebrada)",
                c.id, c.result, faltando
            ));
        }
    }

    // 4) Elementos da trilha precisam ser alcançáveis
    if let Some(tf) = trilhas {
        for t in &tf.trilhas {
            for e in &t.elementos {
                if !nivel.contains_key(e) {
                    erros.push(format!("trilha '{}': elemento '{}' é inalcançável", t.id, e));
                }
            }
        }
    }

    if erros.is_empty() {
        Ok(nivel)
    } else {
        Err(erros)
    }
}

// Uso no main.rs, logo após carregar os JSON:
//
//   if let Err(erros) = validacao::validar(&combos, Some(&trilhas)) {
//       eprintln!("combos.json inválido:");
//       for e in erros { eprintln!("  - {e}"); }
//       std::process::exit(1);
//   }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_do_jogo_e_valido() {
        let c: ComboFile =
            serde_json::from_str(&std::fs::read_to_string("data/combos.json").unwrap()).unwrap();
        let t: TrilhaFile =
            serde_json::from_str(&std::fs::read_to_string("data/trilhas.json").unwrap()).unwrap();
        if let Err(erros) = validar(&c, Some(&t)) {
            panic!("\n{}", erros.join("\n"));
        }
    }

    #[test]
    fn ciclo_nao_estoura_pilha() {
        let c: ComboFile = serde_json::from_str(r#"{
            "elementos_base": ["A"],
            "combinacoes": [
                {"id":1,"combo":["A","Y"],"result":"X","tier":1},
                {"id":2,"combo":["A","X"],"result":"Y","tier":1}
            ]}"#).unwrap();
        assert_eq!(validar(&c, None).unwrap_err().len(), 2);
    }
}