// Regras puras do rodízio. Não sorteia nem escolhe jogadores automaticamente.
export function validarSubstituicao({ equipePerdedora, aguardando, participanteSaiId, participanteEntraId }) {
  if (!equipePerdedora?.jogadores?.length) return 'O time perdedor não tem jogadores disponíveis para substituir.';
  if (!aguardando?.length) return 'Não há jogadores na fila de espera.';
  if (!participanteSaiId) return 'Escolha quem vai sair de campo.';
  if (!participanteEntraId) return 'Escolha quem vai entrar em campo.';
  const sai = equipePerdedora.jogadores.find((p) => p.id === participanteSaiId);
  if (!sai) return 'O jogador escolhido para sair não pertence ao time perdedor.';
  const entra = aguardando.find((p) => p.id === participanteEntraId);
  if (!entra) return 'O jogador escolhido para entrar não está na fila de espera.';
  if (participanteSaiId === participanteEntraId) return 'O mesmo jogador não pode sair e entrar na substituição.';
  return null;
}

export function aplicarSubstituicao({ equipes, aguardando, equipePerdedoraId, participanteSaiId, participanteEntraId }) {
  const equipePerdedora = equipes.find((e) => e.id === equipePerdedoraId);
  const erro = validarSubstituicao({ equipePerdedora, aguardando, participanteSaiId, participanteEntraId });
  if (erro) throw new Error(erro);
  return {
    equipes: equipes.map((e) => e.id !== equipePerdedoraId ? e : {
      ...e,
      jogadores: e.jogadores.map((p) => p.id === participanteSaiId
        ? aguardando.find((x) => x.id === participanteEntraId)
        : p),
    }),
    aguardando: [
      ...aguardando.filter((p) => p.id !== participanteEntraId),
      equipePerdedora.jogadores.find((p) => p.id === participanteSaiId),
    ],
  };
}
