# Desafio Bíblico

Jogo de combinação de elementos bíblicos, servido via web numa intranet local (Raspberry Pi 3).
Backend em Rust (Axum + Askama), frontend em HTML/CSS/JS puro — sem dependências externas em runtime, então funciona 100% offline.

## Rodando localmente (no seu PC, pra testar)

```bash
cd desafio-biblico
cargo run
```

Acesse http://localhost:8080

## Deploy no Raspberry Pi 3

⚠️ **Importante: o Pi3 tem só 1GB de RAM.** Rodar o jogo nele é tranquilo (o binário
usa pouquíssima memória), mas **compilar Rust direto no Pi3 é arriscado** — o processo
de build pode ficar sem memória e travar. A solução é **compilar no seu PC** (cross-compilation)
e mandar só o binário final pro Pi.

### Opção recomendada: compilar no PC, rodar no Pi (cross-compilation)

No seu PC (com Rust instalado), instale o [`cross`](https://github.com/cross-rs/cross)
(usa Docker por baixo, então precisa do Docker instalado):

```bash
cargo install cross --git https://github.com/cross-rs/cross
```

Descubra se o seu Raspberry Pi OS é 32-bit ou 64-bit (`uname -m` no Pi: `armv7l` = 32-bit,
`aarch64` = 64-bit). Pra 32-bit (o mais comum no Pi3), use o target `musl`, que gera um
binário **totalmente estático** — evita qualquer problema de versão de glibc entre seu PC e o Pi:

```bash
cross build --release --target armv7-unknown-linux-musleabihf
```

(Se seu Pi3 estiver com o Raspberry Pi OS 64-bit, troque o target por `aarch64-unknown-linux-musl`.)

O binário sai em `target/armv7-unknown-linux-musleabihf/release/desafio-biblico`.

Agora copie só o necessário pro Pi (o binário + os arquivos que ele lê em runtime —
**não precisa do código-fonte nem do Cargo.toml**):

```bash
scp target/armv7-unknown-linux-musleabihf/release/desafio-biblico pi@<ip-do-pi>:~/desafio-biblico/
scp -r data static templates pi@<ip-do-pi>:~/desafio-biblico/
```

No Pi3, só rodar:

```bash
cd ~/desafio-biblico
./desafio-biblico
```

Sem Rust, sem `cargo build`, sem risco de travar por memória.

### Opção alternativa: compilar direto no Pi3 (mais lento e arriscado)

Se preferir mesmo assim compilar no Pi3, pelo menos configure um swap maior antes,
senão o build provavelmente vai morrer no meio:

```bash
sudo dphys-swapfile swapoff
sudo sed -i 's/CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

Depois disso, `cargo build --release` deve funcionar no Pi3, mas espere ele demorar
bem mais que no seu PC.

O servidor sobe em `0.0.0.0:8080`, ou seja, já fica acessível por qualquer celular
conectado na mesma rede do Pi (ex: `http://192.168.x.x:8080`).

### Deixar rodando sempre (systemd)

Crie `/etc/systemd/system/desafio.service`:

```ini
[Unit]
Description=Desafio Biblico
After=network.target

[Service]
WorkingDirectory=/home/pi/desafio-biblico
ExecStart=/home/pi/desafio-biblico/desafio-biblico
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now desafio
```

### Transformar o Pi3 em ponto de acesso wifi próprio (opcional)

Se a igreja não tiver wifi ou você quiser uma rede isolada só pro jogo, use `hostapd` + `dnsmasq`
pro Pi3 virar o próprio roteador. Posso te ajudar com isso depois, quando chegar nessa etapa.

## Estrutura do projeto

```
desafio-biblico/
├── Cargo.toml
├── data/
│   └── combos.json      ← todas as combinações do jogo (edite aqui pra adicionar mais)
├── src/
│   ├── main.rs           ← servidor, rotas, lógica de combinação e ranking
│   └── templates.rs       ← struct do template Askama
├── templates/
│   └── index.html         ← página principal (Askama)
└── static/
    ├── css/style.css      ← visual do jogo
    └── js/game.js          ← lógica de front (seleção, combinar, ranking)
```

## Como adicionar novas combinações

Edite `data/combos.json`. Cada entrada segue o formato:

```json
{"id": 200, "combo": ["Elemento A", "Elemento B"], "result": "Novo Elemento", "tier": 5}
```

Não importa a ordem de A/B — o backend normaliza automaticamente.
Reinicie o servidor pra recarregar os dados (não precisa recompilar).

## Estado atual

- ~113 combinações modeladas (Criação, Patriarcas, Êxodo, Juízes, Reis, Genealogia de Jesus, Evangelhos)
- Sistema de pontos escalado por raridade (tier da árvore de combinação → Comum/Incomum/Raro/Épico/Lendário/Mítico, 10 a 100 pontos)
- Trilhas temáticas com progresso visual, e o inventário filtra pra mostrar só a base relevante da trilha escolhida
- Ranking em tempo quase-real na tela do jogador (`/`, atualiza a cada 5s) e um telão dedicado em tela cheia pra projetar no evento (`/telao`, atualiza a cada 3s)
- Cache-busting automático nos assets (CSS/JS) a cada reinício do servidor
- Estado do jogo fica em memória (reinicia zerado se o servidor cair — se quiser persistência entre reinicializações, o próximo passo natural é trocar por SQLite)

## Rotas disponíveis

- `/` — tela do jogador (login, combinar, trilhas, ranking)
- `/telao` — ranking em tela cheia pra projetar numa TV/telão durante o evento
- `/api/combine`, `/api/ranking`, `/api/trilhas`, `/api/inventario`, `/api/progresso` — API JSON

## Próximos passos sugeridos

1. Testar em rede local (2-3 celulares) antes do evento
2. Adicionar mais combinações (Profetas, Atos, Cartas, Virtudes x Vícios)
3. Persistência em SQLite pra não perder progresso se o Pi reiniciar
