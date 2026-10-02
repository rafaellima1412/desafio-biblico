use axum::{
    extract::{DefaultBodyLimit, Json, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tower_http::services::ServeDir;

mod templates;
use templates::{IndexTemplate, TelaoTemplate};

// ---- Limites de proteção (jogo exposto na internet via DDNS) ----
// Tamanho máximo do nome do jogador (em caracteres).
const MAX_NOME_JOGADOR: usize = 24;
// Máximo de jogadores simultâneos guardados em memória (o Pi3 tem só 1GB).
const MAX_JOGADORES: usize = 50;
// Tamanho máximo do corpo de uma requisição POST.
const MAX_BODY_BYTES: usize = 4 * 1024;

// combos.json usa array [a, b]; fazemos a conversão manual no load.
#[derive(Debug, Deserialize)]
struct RawComboEntry {
    #[allow(dead_code)]
    id: u32,
    combo: [String; 2],
    result: String,
    tier: u32,
}

#[derive(Debug, Deserialize)]
struct ComboFile {
    elementos_base: Vec<String>,
    combinacoes: Vec<RawComboEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct Trilha {
    id: String,
    nome: String,
    elementos: Vec<String>,
    // calculado no startup, não vem do trilhas.json — lista de elementos base
    // necessários pra chegar em qualquer elemento desta trilha (usado pra
    // filtrar o painel de inventário e não poluir a tela com base de outros arcos)
    #[serde(default)]
    elementos_base_relacionados: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct TrilhasFile {
    trilhas: Vec<Trilha>,
}

fn load_trilhas() -> Vec<Trilha> {
    let raw =
        std::fs::read_to_string("data/trilhas.json").expect("não consegui ler data/trilhas.json");
    let parsed: TrilhasFile = serde_json::from_str(&raw).expect("JSON inválido em trilhas.json");
    parsed.trilhas
}

// Percorre a árvore de combinações de trás pra frente a partir de um elemento
// até encontrar todos os elementos base necessários pra alcançá-lo.
fn coletar_base_ancestral(
    elemento: &str,
    combo_by_result: &HashMap<String, (String, String)>,
    base_set: &HashSet<String>,
    out: &mut HashSet<String>,
) {
    if base_set.contains(elemento) {
        out.insert(elemento.to_string());
        return;
    }
    if let Some((a, b)) = combo_by_result.get(elemento) {
        coletar_base_ancestral(a, combo_by_result, base_set, out);
        coletar_base_ancestral(b, combo_by_result, base_set, out);
    }
    // elemento desconhecido (não deveria acontecer se os dados passaram na auditoria)
}

fn calcular_base_de_cada_trilha(
    trilhas: &mut [Trilha],
    combo_by_result: &HashMap<String, (String, String)>,
    elementos_base: &[String],
) {
    let base_set: HashSet<String> = elementos_base.iter().cloned().collect();
    for trilha in trilhas.iter_mut() {
        let mut encontrados = HashSet::new();
        for el in &trilha.elementos {
            coletar_base_ancestral(el, combo_by_result, &base_set, &mut encontrados);
        }
        let mut lista: Vec<String> = encontrados.into_iter().collect();
        lista.sort();
        trilha.elementos_base_relacionados = lista;
    }
}

// Estado do jogo, tudo em memória (suficiente pro volume de um evento)
struct AppState {
    // chave normalizada "A|B" (ordem alfabética) -> (resultado, tier)
    lookup: HashMap<String, (String, u32)>,
    elementos_base: Vec<String>,
    trilhas: Vec<Trilha>,
    // nome do jogador -> elementos descobertos
    players: Mutex<HashMap<String, HashSet<String>>>,
    // nome do jogador -> pontuação
    scores: Mutex<HashMap<String, u32>>,
    // timestamp de quando o servidor subiu, usado como "?v=" nos assets
    // pra forçar o navegador a buscar CSS/JS novos a cada deploy (cache-busting)
    versao: u64,
}

fn normalize_key(a: &str, b: &str) -> String {
    let mut pair = [a, b];
    pair.sort();
    format!("{}|{}", pair[0], pair[1])
}

// Valida e limpa o nome do jogador. Aceita letras (com acento), números,
// espaço, hífen, underscore e ponto. Rejeita qualquer coisa como < > & " '
// pra impedir injeção de HTML/JS no ranking e no telão.
fn validar_nome(raw: &str) -> Option<String> {
    let nome = raw.trim();
    if nome.is_empty() || nome.chars().count() > MAX_NOME_JOGADOR {
        return None;
    }
    let ok = nome
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.'));
    if ok {
        Some(nome.to_string())
    } else {
        None
    }
}

fn load_combos() -> (
    HashMap<String, (String, u32)>,
    HashMap<String, (String, String)>,
    Vec<String>,
) {
    let raw =
        std::fs::read_to_string("data/combos.json").expect("não consegui ler data/combos.json");
    let parsed: ComboFile = serde_json::from_str(&raw).expect("JSON inválido em combos.json");

    let mut lookup = HashMap::new();
    let mut combo_by_result = HashMap::new();
    for entry in parsed.combinacoes {
        let key = normalize_key(&entry.combo[0], &entry.combo[1]);
        lookup.insert(key, (entry.result.clone(), entry.tier));
        combo_by_result.insert(
            entry.result,
            (entry.combo[0].clone(), entry.combo[1].clone()),
        );
    }
    (lookup, combo_by_result, parsed.elementos_base)
}

// Quanto mais alto o tier (mais "profunda" a combinação na árvore),
// mais rara e mais pontos vale a descoberta.
fn raridade_info(tier: u32) -> (&'static str, &'static str, u32) {
    match tier {
        0..=2 => ("comum", "Leitor da Bíblia", 10),
        3..=4 => ("incomum", "Aprendiz de Profeta", 20),
        5..=6 => ("raro", "Carruagem de Fogo", 35),
        7..=8 => ("epico", "Matador de Gigante", 50),
        9..=10 => ("lendario", "Labareda de Fogo", 75),
        _ => ("mitico", "Manto da Revelação", 100),
    }
}

#[derive(Deserialize)]
struct CombineRequest {
    player: String,
    a: String,
    b: String,
}

#[derive(Serialize)]
struct CombineResponse {
    success: bool,
    result: Option<String>,
    novo: bool, // true se o jogador nunca tinha descoberto esse elemento
    tier: Option<u32>,
    raridade: Option<&'static str>,
    pontos_ganhos: u32, // pontos ganhos NESTA combinação (0 se já tinha ou se falhou)
    pontos: u32,        // total acumulado do jogador
}

fn combine_falha() -> CombineResponse {
    CombineResponse {
        success: false,
        result: None,
        novo: false,
        tier: None,
        raridade: None,
        pontos_ganhos: 0,
        pontos: 0,
    }
}

async fn combine(State(state): State<Arc<AppState>>, Json(req): Json<CombineRequest>) -> Response {
    // Nome inválido: devolve o mesmo formato JSON de falha (com status 400)
    // pra não quebrar o front, que sempre espera um CombineResponse.
    let Some(player) = validar_nome(&req.player) else {
        return (StatusCode::BAD_REQUEST, Json(combine_falha())).into_response();
    };

    let key = normalize_key(&req.a, &req.b);

    let Some((result, tier)) = state.lookup.get(&key).cloned() else {
        return Json(combine_falha()).into_response();
    };

    let (_alias, raridade, pontos_por_raridade) = raridade_info(tier);

    let mut players = state.players.lock().unwrap();

    // Limite de jogadores em memória: só bloqueia NOVOS nomes.
    if !players.contains_key(&player) && players.len() >= MAX_JOGADORES {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(combine_falha())).into_response();
    }

    let discovered = players.entry(player.clone()).or_default();
    let novo = discovered.insert(result.clone());

    let pontos_ganhos = if novo { pontos_por_raridade } else { 0 };
    if novo {
        let mut scores = state.scores.lock().unwrap();
        *scores.entry(player.clone()).or_insert(0) += pontos_ganhos;
    }
    let total = *state.scores.lock().unwrap().get(&player).unwrap_or(&0);

    Json(CombineResponse {
        success: true,
        result: Some(result),
        novo,
        tier: Some(tier),
        raridade: Some(raridade),
        pontos_ganhos,
        pontos: total,
    })
    .into_response()
}

#[derive(Serialize)]
struct RankingEntry {
    player: String,
    score: u32,
}

async fn ranking(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let scores = state.scores.lock().unwrap();
    let mut entries: Vec<RankingEntry> = scores
        .iter()
        .map(|(player, score)| RankingEntry {
            player: player.clone(),
            score: *score,
        })
        .collect();
    entries.sort_by(|a, b| b.score.cmp(&a.score));
    Json(entries)
}

async fn index(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    IndexTemplate {
        elementos_base: state.elementos_base.clone(),
        versao: state.versao,
    }
}

async fn telao(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    TelaoTemplate {
        versao: state.versao,
    }
}

async fn listar_trilhas(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(state.trilhas.clone())
}

#[derive(Deserialize)]
struct PlayerQuery {
    player: String,
}

#[derive(Serialize)]
struct InventoryResponse {
    elementos: Vec<String>,
    pontos: u32,
}

async fn inventario(
    State(state): State<Arc<AppState>>,
    Query(q): Query<PlayerQuery>,
) -> impl IntoResponse {
    let players = state.players.lock().unwrap();
    let mut elementos: Vec<String> = state.elementos_base.clone();
    if let Some(descobertos) = players.get(&q.player) {
        elementos.extend(descobertos.iter().cloned());
    }
    let pontos = *state.scores.lock().unwrap().get(&q.player).unwrap_or(&0);
    Json(InventoryResponse { elementos, pontos })
}

#[derive(Serialize)]
struct TrilhaProgressoItem {
    nome: String,
    descoberto: bool,
}

#[derive(Serialize)]
struct TrilhaProgresso {
    id: String,
    nome: String,
    total: usize,
    descobertos: usize,
    elementos: Vec<TrilhaProgressoItem>,
}

async fn progresso(
    State(state): State<Arc<AppState>>,
    Query(q): Query<PlayerQuery>,
) -> impl IntoResponse {
    let players = state.players.lock().unwrap();
    let descobertos_do_jogador: HashSet<String> =
        players.get(&q.player).cloned().unwrap_or_default();

    let trilhas_progresso: Vec<TrilhaProgresso> = state
        .trilhas
        .iter()
        .map(|t| {
            let itens: Vec<TrilhaProgressoItem> = t
                .elementos
                .iter()
                .map(|el| TrilhaProgressoItem {
                    nome: el.clone(),
                    // elemento base também conta como "sempre disponível", mas
                    // o que marca progresso de verdade é ter sido descoberto por combinação
                    descoberto: descobertos_do_jogador.contains(el),
                })
                .collect();
            let descobertos = itens.iter().filter(|i| i.descoberto).count();
            TrilhaProgresso {
                id: t.id.clone(),
                nome: t.nome.clone(),
                total: t.elementos.len(),
                descobertos,
                elementos: itens,
            }
        })
        .collect();

    Json(trilhas_progresso)
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let (lookup, combo_by_result, elementos_base) = load_combos();
    let mut trilhas = load_trilhas();
    calcular_base_de_cada_trilha(&mut trilhas, &combo_by_result, &elementos_base);
    tracing::info!(
        "Carregadas {} combinações e {} trilhas",
        lookup.len(),
        trilhas.len()
    );

    let versao = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let state = Arc::new(AppState {
        lookup,
        elementos_base,
        trilhas,
        players: Mutex::new(HashMap::new()),
        scores: Mutex::new(HashMap::new()),
        versao,
    });

    let app = Router::new()
        .route("/", get(index))
        .route("/telao", get(telao))
        .route("/api/combine", post(combine))
        .route("/api/ranking", get(ranking))
        .route("/api/trilhas", get(listar_trilhas))
        .route("/api/inventario", get(inventario))
        .route("/api/progresso", get(progresso))
        .nest_service("/static", ServeDir::new("static"))
        // Corpo de requisição limitado (o JSON do jogo tem poucas dezenas de bytes)
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state);

    // Endereço configurável por variável de ambiente BIND_ADDR.
    // Padrão: 0.0.0.0:8080 (acessível na rede local e pelo redirecionamento de porta).
    // Se colocar um proxy (Caddy) na frente, use BIND_ADDR=127.0.0.1:8080.
    let addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("não consegui abrir {}: {}", addr, e));
    tracing::info!("Servidor rodando em http://{}", addr);
    axum::serve(listener, app).await.unwrap();
}
