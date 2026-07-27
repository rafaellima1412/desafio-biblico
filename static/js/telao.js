const medalhas = ["🥇", "🥈", "🥉"];

async function atualizarTelao() {
  try {
    const resp = await fetch("/api/ranking");
    const dados = await resp.json();
    const container = document.getElementById("lista-ranking");

    if (dados.length === 0) {
      container.innerHTML = '<p class="vazio">Aguardando jogadores...</p>';
      return;
    }

    container.innerHTML = dados
      .map((entry, idx) => {
        const posicao = idx + 1;
        const classeTop = posicao <= 3 ? `top${posicao}` : "";
        const medalha = medalhas[idx] || "";
        return `
          <div class="linha-ranking ${classeTop}">
            <span class="posicao">${posicao}º</span>
            <span class="medalha">${medalha}</span>
            <span class="nome-jogador">${escapeHtml(entry.player)}</span>
            <span class="pontos-jogador">${entry.score} pts</span>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    console.error("Falha ao atualizar ranking:", err);
  }
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}

function atualizarRelogio() {
  const agora = new Date();
  document.getElementById("relogio").textContent =
    "Atualizado às " + agora.toLocaleTimeString("pt-BR");
}

atualizarTelao();
atualizarRelogio();
setInterval(atualizarTelao, 3000);
setInterval(atualizarRelogio, 1000);
