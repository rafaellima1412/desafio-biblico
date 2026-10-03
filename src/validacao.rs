// src/validacao.rs
// Valida data/combos.json e data/trilhas.json ANTES do servidor montar o estado.
// A resolução do grafo é ITERATIVA (sem recursão): um ciclo no JSON vira
// mensagem de erro, nunca stack overflow.

use crate::{ComboFile, RawComboEntry, Trilha};
use std::collections::{HashMap, HashSet};

pub(crate) fn validar(data: &ComboFile, trilhas: &[Trilha]) -> Result<(), Vec<String>> {
    let mut erros = Vec::new();

    // 1) Ids repetidos e pares A+B repetidos (o lookup ficaria só com o último)
    let mut ids: HashSet<u32> = HashSet::new();
    let mut pares: HashMap<(&str, &str), u32> = HashMap::new();
    for c in &data.combinacoes {
        if !ids.insert(c.id) {
            erros.push(format!("id {} aparece mais de uma vez", c.id));
        }
        let mut k = [c.combo[0].as_str(), c.combo[1].as_str()];
        k.sort();
        if let Some(outro) = pares.insert((k[0], k[1]), c.id) {
            erros.push(format!(
                "par [{} + {}] repetido nos ids {} e {}",
                k[0], k[1], outro, c.id
            ));
        }
    }

    // 2) Resolução iterativa a partir dos elementos base (ponto fixo)
    let mut alcancaveis: HashSet<&str> =
        data.elementos_base.iter().map(|s| s.as_str()).collect();
    let mut pendentes: Vec<&RawComboEntry> = data.combinacoes.iter().collect();

    loop {
        let antes = pendentes.len();
        pendentes.retain(|&c| {
            if alcancaveis.contains(c.combo[0].as_str())
                && alcancaveis.contains(c.combo[1].as_str())
            {
                alcancaveis.insert(c.result.as_str());
                false // resolvida, sai da lista
            } else {
                true
            }
        });
        if pendentes.len() == antes {
            break; // nenhuma combinação nova resolvida nesta passada
        }
    }

    // 3) O que sobrou é inalcançável: ingrediente órfão ou ciclo
    let produziveis: HashSet<&str> = data
        .combinacoes
        .iter()
        .map(|c| c.result.as_str())
        .chain(data.elementos_base.iter().map(|s| s.as_str()))
        .collect();

    for c in &pendentes {
        let faltando: Vec<&str> = c
            .combo
            .iter()
            .map(|s| s.as_str())
            .filter(|x| !alcancaveis.contains(x))
            .collect();
        let orfaos: Vec<&str> = faltando
            .iter()
            .copied()
            .filter(|x| !produziveis.contains(x))
            .collect();
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

    // 4) Todo elemento de trilha precisa ser alcançável
    for t in trilhas {
        for e in &t.elementos {
            if !alcancaveis.contains(e.as_str()) {
                erros.push(format!("trilha '{}': elemento '{}' é inalcançável", t.id, e));
            }
        }
    }

    // 5) Toda dica precisa apontar para um elemento que existe na trilha
    //    (pega erro de digitação no nome da chave)
    for t in trilhas {
        for chave in t.dicas.keys() {
            if !t.elementos.contains(chave) {
                erros.push(format!(
                    "trilha '{}': dica para '{}', que não está na lista de elementos",
                    t.id, chave
                ));
            }
        }
    }

    if erros.is_empty() {
        Ok(())
    } else {
        Err(erros)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TrilhasFile;

    // Roda com `cargo test` no PC antes de copiar os JSON pro Pi.
    #[test]
    fn json_do_jogo_e_valido() {
        let c: ComboFile =
            serde_json::from_str(&std::fs::read_to_string("data/combos.json").unwrap()).unwrap();
        let t: TrilhasFile =
            serde_json::from_str(&std::fs::read_to_string("data/trilhas.json").unwrap()).unwrap();
        if let Err(erros) = validar(&c, &t.trilhas) {
            panic!("\n{}", erros.join("\n"));
        }
    }

    #[test]
    fn ciclo_vira_erro_e_nao_estoura_pilha() {
        let c: ComboFile = serde_json::from_str(
            r#"{
            "elementos_base": ["A"],
            "combinacoes": [
                {"id":1,"combo":["A","Y"],"result":"X","tier":1},
                {"id":2,"combo":["A","X"],"result":"Y","tier":1}
            ]}"#,
        )
        .unwrap();
        assert_eq!(validar(&c, &[]).unwrap_err().len(), 2);
    }
}