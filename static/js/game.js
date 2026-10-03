let player = null;
let score = 0;
let selecionados = [];
let trilhaAtual = null;
let trilhasData = [];

const $ = (sel) => document.querySelector(sel);

$("#btn-entrar").addEventListener("click", async () => {
  const nome = $("#player-name").value.trim();
  if (!nome) return;
  player = nome;
  $("#login-box").classList.add("hidden");
  $("#score-box").classList.remove("hidden");
  $("#game").classList.remove("hidden");
  $("#trilha-box").classList.remove("hidden");
  $("#player-label").textContent = player;

  await restaurarInventario();
  await carregarTrilhas();
  atualizarRanking();
});

function renderSlots() {
  $("#slot-a").textContent = selecionados[0] || "Elemento A";
  $("#slot-a").classList.toggle("preenchido", !!selecionados[0]);
  $("#slot-b").textContent = selecionados[1] || "Elemento B";
  $("#slot-b").classList.toggle("preenchido", !!selecionados[1]);

  // destaca no inventário quais elementos estão selecionados agora
  document.querySelectorAll(".elemento").forEach((btn) => {
    btn.classList.toggle("selecionado", selecionados.includes(btn.dataset.nome));
  });
}

function adicionarElemento(nome) {
  if (selecionados.includes(nome)) {
    // clicar de novo num elemento já selecionado desmarca ele
    selecionados = selecionados.filter((n) => n !== nome);
  } else {
    if (selecionados.length >= 2) selecionados.shift();
    selecionados.push(nome);
  }
  renderSlots();
}

function removerDoSlot(indice) {
  selecionados.splice(indice, 1);
  renderSlots();
}

$("#slot-a").addEventListener("click", () => removerDoSlot(0));
$("#slot-b").addEventListener("click", () => removerDoSlot(1));

// nome descoberto por combinação -> sempre verde ("descoberto").
// elementos base já vêm renderizados pelo servidor com a classe "base" (branco).
function adicionarAoInventario(nome) {
  if (document.querySelector(`.elemento[data-nome="${CSS.escape(nome)}"]`)) return;
  const btn = document.createElement("button");
  btn.className = "elemento descoberto";
  btn.dataset.nome = nome;
  btn.textContent = nome;
  btn.addEventListener("click", () => adicionarElemento(nome));
  $("#inventory").appendChild(btn);
}

// delega clique nos elementos já renderizados pelo servidor (base)
document.querySelectorAll(".elemento").forEach((btn) => {
  btn.addEventListener("click", () => adicionarElemento(btn.dataset.nome));
});

$("#btn-combinar").addEventListener("click", async () => {
  if (selecionados.length !== 2 || !player) return;
  const [a, b] = selecionados;

  const resp = await fetch("/api/combine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player, a, b }),
  });
  const data = await resp.json();
  const el = $("#resultado");

  if (!data.success) {
    el.textContent = `${a} + ${b} = nada acontece...`;
    el.className = "falha";
  } else {
    if (data.novo) {
      // data.raridade = nome exibido (ex: "Leitor da Bíblia")
      // data.raridade_id = id usado na classe CSS (ex: "comum")
      el.innerHTML = `✨ Descoberta! ${a} + ${b} = <strong>${data.result}</strong> ` +
        `<span class="badge-raridade raridade-${data.raridade_id}">${data.raridade}</span> ` +
        `(+${data.pontos_ganhos} pontos)`;
    } else {
      el.textContent = `${a} + ${b} = ${data.result} (já descoberto)`;
    }
    el.className = "sucesso";
    adicionarAoInventario(data.result);
    score = data.pontos;
    $("#score-label").textContent = score;
    atualizarRanking();
    if (data.novo && trilhaAtual) {
      await renderizarTrilha(trilhaAtual);
    }
    // toda descoberta nova pode ter fechado uma trilha (mesmo sem trilha selecionada)
    if (data.novo) {
      await verificarTrilhasConcluidas();
    }
  }

  selecionados = [];
  renderSlots();
});

async function restaurarInventario() {
  const resp = await fetch(`/api/inventario?player=${encodeURIComponent(player)}`);
  const data = await resp.json();
  score = data.pontos;
  $("#score-label").textContent = score;

  const baseNomes = new Set(
    Array.from(document.querySelectorAll(".elemento.base")).map((b) => b.dataset.nome)
  );
  data.elementos.forEach((nome) => {
    if (!baseNomes.has(nome)) adicionarAoInventario(nome);
  });
}

async function carregarTrilhas() {
  const resp = await fetch("/api/trilhas");
  trilhasData = await resp.json();
  const select = $("#trilha-select");
  trilhasData.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.nome;
    select.appendChild(opt);
  });
}

// Ao escolher uma trilha, esconde os elementos base que não têm nada a ver
// com ela (evita a poluição de mostrar 58 elementos quando só uns 10 importam
// pra trilha escolhida). Elementos já descobertos continuam sempre visíveis.
function filtrarBasePorTrilha(trilhaId) {
  const botoesBase = document.querySelectorAll(".elemento.base");
  if (!trilhaId) {
    botoesBase.forEach((b) => b.classList.remove("hidden"));
    return;
  }
  const trilha = trilhasData.find((t) => t.id === trilhaId);
  if (!trilha) return;
  const relacionados = new Set(trilha.elementos_base_relacionados);
  botoesBase.forEach((b) => {
    b.classList.toggle("hidden", !relacionados.has(b.dataset.nome));
  });
}

$("#trilha-select").addEventListener("change", (e) => {
  trilhaAtual = e.target.value || null;
  filtrarBasePorTrilha(trilhaAtual);
  if (trilhaAtual) renderizarTrilha(trilhaAtual);
  else {
    $("#trilha-path").innerHTML = "";
    $("#trilha-progresso-label").textContent = "";
  }
});

async function renderizarTrilha(trilhaId) {
  const resp = await fetch(`/api/progresso?player=${encodeURIComponent(player)}`);
  const trilhas = await resp.json();
  const trilha = trilhas.find((t) => t.id === trilhaId);
  if (!trilha) return;

  $("#trilha-progresso-label").textContent =
    `${trilha.nome}: ${trilha.descobertos} / ${trilha.total} descobertos`;

  const path = $("#trilha-path");
  path.innerHTML = "";

  trilha.elementos.forEach((item, idx) => {
    if (idx > 0) {
      const conn = document.createElement("span");
      conn.className = "trilha-connector" + (item.descoberto && trilha.elementos[idx - 1].descoberto ? " concluido" : "");
      conn.textContent = "→";
      path.appendChild(conn);
    }
    const step = document.createElement("div");
    step.className = "trilha-step" + (item.descoberto ? " concluido" : "");
    const circulo = document.createElement("div");
    circulo.className = "circulo";
    const label = document.createElement("span");
    label.textContent = item.nome;
    step.appendChild(circulo);
    step.appendChild(label);
    // dica (referência bíblica): o servidor só envia para itens não descobertos
    if (item.dica) {
      const dica = document.createElement("small");
      dica.className = "trilha-dica hidden"; // começa escondida
      dica.textContent = item.dica;
      step.appendChild(dica);
      step.title = "Toque para ver a dica";
      // tocar no passo mostra a dica; tocar de novo esconde
      step.addEventListener("click", () => dica.classList.toggle("hidden"));
    }
    path.appendChild(step);
  });
}

async function atualizarRanking() {
  const resp = await fetch("/api/ranking");
  const data = await resp.json();
  const lista = $("#ranking-list");
  lista.innerHTML = "";
  data.forEach((entry) => {
    const li = document.createElement("li");
    li.textContent = `${entry.player} — ${entry.score} pts`;
    lista.appendChild(li);
  });
}

setInterval(() => {
  if (player) atualizarRanking();
}, 5000); // atualiza ranking em tempo quase-real, bom pro telão da igreja

// =====================================================================
// Animação de trilha concluída
// =====================================================================

// id da trilha -> função da animação. Trilhas sem entrada aqui não animam
// (evita mostrar a cena de Mateus 4 quando outra trilha for concluída).
const ANIMACOES_TRILHA = {
  tentacao: animacaoTentacao,
};

// Toca uma vez por jogador e por trilha, guardado no navegador.
function chaveVitoria(trilhaId) {
  return `vitoria:${player}:${trilhaId}`;
}
function jaMostrouVitoria(trilhaId) {
  try {
    return localStorage.getItem(chaveVitoria(trilhaId)) === "1";
  } catch (e) {
    return false;
  }
}
function marcarVitoriaMostrada(trilhaId) {
  try {
    localStorage.setItem(chaveVitoria(trilhaId), "1");
  } catch (e) {
    // navegador sem storage: a animação pode repetir, sem outro efeito
  }
}

async function verificarTrilhasConcluidas() {
  try {
    const resp = await fetch(`/api/progresso?player=${encodeURIComponent(player)}`);
    const trilhas = await resp.json();
    const concluida = trilhas.find(
      (t) =>
        t.total > 0 &&
        t.descobertos === t.total &&
        ANIMACOES_TRILHA[t.id] &&
        !jaMostrouVitoria(t.id)
    );
    if (concluida) {
      marcarVitoriaMostrada(concluida.id);
      await ANIMACOES_TRILHA[concluida.id]();
    }
  } catch (e) {
    console.error("Falha ao verificar trilhas concluídas:", e);
  }
}

// CSS da cena, injetado uma vez (não precisa mexer no style.css)
function injetarEstiloVitoria() {
  if (document.getElementById("vitoria-style")) return;
  const s = document.createElement("style");
  s.id = "vitoria-style";
  s.textContent = `
.vitoria-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:16px}
.vitoria-cena{position:relative;width:min(640px,100%);height:340px;background:#14121c;border-radius:12px;overflow:hidden;font-family:monospace}
.vitoria-chao{position:absolute;left:0;right:0;bottom:40px;height:8px;background:#2a2638}
.vitoria-spr{position:absolute;bottom:48px;width:min(128px,26vw);height:auto;image-rendering:pixelated}
.vitoria-tentador{filter:drop-shadow(2px 0 0 #b3262e) drop-shadow(-2px 0 0 #b3262e) drop-shadow(0 2px 0 #b3262e) drop-shadow(0 -2px 0 #b3262e)}
.vitoria-fala{position:absolute;left:0;right:0;text-align:center;color:#fff;opacity:0;padding:0 12px}
.vitoria-px{position:absolute;width:6px;height:6px}
.vitoria-fechar{position:absolute;left:50%;bottom:6px;transform:translateX(-50%);opacity:0;pointer-events:none;font-family:monospace;font-size:16px;padding:6px 18px;background:#ebd515;color:#14121c;border:none;border-radius:4px;cursor:pointer}
`;
  document.head.appendChild(s);
}

// Cena de Mateus 4: Jesus avança, "Vai-te, Satanás!" (v.10),
// o tentador foge e caem brilhos lembrando os anjos (v.11).
async function animacaoTentacao() {
  injetarEstiloVitoria();

  const overlay = document.createElement("div");
  overlay.className = "vitoria-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Trilha concluída");
  overlay.innerHTML = `
    <div class="vitoria-cena">
      <div class="vitoria-chao"></div>
      <img class="vitoria-spr" src="/static/img/jesus.svg" alt="Jesus" style="left:14%">
      <img class="vitoria-spr vitoria-tentador" src="/static/img/tentador.svg" alt="Tentador" style="left:62%">
      <div class="vitoria-fala" style="top:36px;font-size:22px">"Vai-te, Satanás!"</div>
      <div class="vitoria-fala" style="top:70px;font-size:13px;color:#c9c2ab">Mt 4:10</div>
      <div class="vitoria-fala" style="top:110px;font-size:20px;color:#ebd515">Trilha concluída!</div>
      <button class="vitoria-fechar" type="button">Fechar</button>
    </div>`;
  document.body.appendChild(overlay);

  const cena = overlay.querySelector(".vitoria-cena");
  const [jesus, tentador] = overlay.querySelectorAll(".vitoria-spr");
  const [fala, ref, fim] = overlay.querySelectorAll(".vitoria-fala");
  const btnFechar = overlay.querySelector(".vitoria-fechar");

  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const onKey = (e) => {
    if (e.key === "Escape") fechar();
  };
  function fechar() {
    timers.forEach(clearTimeout);
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }
  document.addEventListener("keydown", onKey);
  btnFechar.addEventListener("click", fechar);

  // espera os sprites carregarem antes de começar
  await Promise.all([jesus, tentador].map((img) => img.decode().catch(() => {})));

  const aparece = (el) =>
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: "forwards" });
  const some = (el, delay) =>
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, delay, fill: "forwards" });

  // quadradinhos (fumaça e brilhos) que somem ao fim da animação
  function particula(cor, left, top, frames, duracao, delay) {
    const p = document.createElement("div");
    p.className = "vitoria-px";
    p.style.background = cor;
    p.style.left = left;
    p.style.top = top;
    cena.appendChild(p);
    p.animate(frames, { duration: duracao, delay, easing: "steps(8)", fill: "forwards" });
  }

  // o tentador fica do lado direito, então começa espelhado encarando Jesus
  tentador.style.transform = "scaleX(-1)";
  cena.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: "forwards" });

  // 1) Jesus avança em passos
  at(600, () =>
    jesus.animate(
      [
        { transform: "translate(0,0)" },
        { transform: "translate(20px,-6px)" },
        { transform: "translate(40px,0)" },
        { transform: "translate(60px,-6px)" },
        { transform: "translate(80px,0)" },
      ],
      { duration: 900, easing: "steps(4)", fill: "forwards" }
    )
  );

  // 2) fala com a referência
  at(1500, () => {
    aparece(fala);
    aparece(ref);
  });

  // 3) o tentador treme
  at(2000, () =>
    tentador.animate(
      [
        { transform: "scaleX(-1) translateX(0)" },
        { transform: "scaleX(-1) translateX(-6px)" },
        { transform: "scaleX(-1) translateX(6px)" },
        { transform: "scaleX(-1) translateX(0)" },
      ],
      { duration: 150, iterations: 4 }
    )
  );

  // 4) fumaça e fuga para a direita
  at(2700, () => {
    const x = tentador.offsetLeft;
    const y = tentador.offsetTop;
    for (let i = 0; i < 14; i++) {
      particula(
        i % 2 ? "#6b6478" : "#3d3848",
        `${x + 40 + Math.random() * 50}px`,
        `${y + 60 + Math.random() * 60}px`,
        [
          { transform: "translate(0,0)", opacity: 1 },
          { transform: `translate(${(Math.random() - 0.5) * 60}px,${-40 - Math.random() * 50}px)`, opacity: 0 },
        ],
        900 + Math.random() * 400,
        0
      );
    }
    tentador.animate(
      [
        { transform: "scaleX(1) translateX(0)", opacity: 1 },
        { transform: "scaleX(1) translateX(320px)", opacity: 0 },
      ],
      { duration: 800, easing: "steps(8)", fill: "forwards" }
    );
    some(fala, 600);
    some(ref, 600);
  });

  // 5) brilhos caindo (anjos, v.11)
  at(3600, () => {
    for (let i = 0; i < 22; i++) {
      particula(
        i % 3 ? "#ebd515" : "#fefeff",
        `${Math.random() * 95}%`,
        "-10px",
        [
          { transform: "translateY(0)", opacity: 1 },
          { transform: "translateY(300px)", opacity: 0 },
        ],
        1400 + Math.random() * 900,
        Math.random() * 700
      );
    }
  });

  // 6) "Trilha concluída!" e botão Fechar
  at(4300, () => {
    fim.animate(
      [
        { opacity: 0, transform: "scale(0.8)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 400, easing: "steps(4)", fill: "forwards" }
    );
    btnFechar.style.pointerEvents = "auto";
    aparece(btnFechar);
  });
}