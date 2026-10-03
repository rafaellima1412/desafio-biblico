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