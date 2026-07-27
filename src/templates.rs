use askama::Template;

#[derive(Template)]
#[template(path = "index.html")]
pub struct IndexTemplate {
    pub elementos_base: Vec<String>,
    pub versao: u64,
}

#[derive(Template)]
#[template(path = "telao.html")]
pub struct TelaoTemplate {
    pub versao: u64,
}
