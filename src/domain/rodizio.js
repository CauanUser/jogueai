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

/**
 * Valida a configuração dos goleiros fixos sem influenciar o sorteio dos times.
 * Os lados são físicos (esquerda/direita), não os nomes mutáveis das equipes.
 */
export function validarConfiguracaoGoleiros({ quantidade = 0, goleiroEsquerdoId = null, goleiroDireitoId = null, participantes = [] }) {
  if (![0, 1, 2].includes(quantidade)) return 'Escolha 0, 1 ou 2 goleiros fixos.';
  const ids = new Set(participantes.map((p) => p.id));
  if (quantidade >= 1 && (!goleiroEsquerdoId || !ids.has(goleiroEsquerdoId))) return 'Escolha o goleiro fixo do lado esquerdo.';
  if (quantidade === 2 && (!goleiroDireitoId || !ids.has(goleiroDireitoId))) return 'Escolha o goleiro fixo do lado direito.';
  if (quantidade < 2 && goleiroDireitoId) return 'O goleiro do lado direito só pode ser definido quando houver 2 goleiros fixos.';
  if (quantidade === 2 && goleiroEsquerdoId === goleiroDireitoId) return 'Cada lado precisa de um goleiro diferente.';
  return null;
}

/**
 * Guarda qual equipe ocupa cada lado físico. O goleiro fica ligado ao lado;
 * quando uma equipe sai, a equipe que entra nesse lado passa a ser defendida
 * pelo goleiro fixo daquele lado.
 */
export function criarEstadoLados({ equipeEsquerdaId, equipeDireitaId, quantidadeGoleirosFixos = 0, goleiroEsquerdoId = null, goleiroDireitoId = null }) {
  return {
    esquerda: { equipeId: equipeEsquerdaId, goleiroId: quantidadeGoleirosFixos >= 1 ? goleiroEsquerdoId : null },
    direita: { equipeId: equipeDireitaId, goleiroId: quantidadeGoleirosFixos === 2 ? goleiroDireitoId : null },
  };
}

/** Atualiza a ocupação física dos lados após o rodízio, sem trocar os goleiros de lado. */
export function atualizarLadosAposRodizio({ estado, equipeEsquerdaId, equipeDireitaId }) {
  return {
    esquerda: { ...estado.esquerda, equipeId: equipeEsquerdaId },
    direita: { ...estado.direita, equipeId: equipeDireitaId },
  };
}


/**
 * Mantém o vencedor no mesmo lado físico para a próxima partida.
 * A/B representam os lados fixos da quadra, não a ordem vencedor/perdedor.
 */
export function equipesProximaPartidaPorLado({ ladoVencedor, equipeVencedoraId, equipePerdedoraId }) {
  if (!['A', 'B'].includes(ladoVencedor) || !equipeVencedoraId || !equipePerdedoraId || equipeVencedoraId === equipePerdedoraId) {
    throw new Error('Não foi possível determinar os lados da próxima partida.');
  }
  return ladoVencedor === 'A'
    ? { equipeAId: equipeVencedoraId, equipeBId: equipePerdedoraId }
    : { equipeAId: equipePerdedoraId, equipeBId: equipeVencedoraId };
}
