const ERROR_MESSAGES: Record<string, string> = {
  MISSING_CREDENTIALS: 'Usuário e senha são obrigatórios.',
  INVALID_CREDENTIALS: 'Usuário ou senha incorretos.',
  UNAUTHORIZED: 'Sessão expirada. Faça login novamente.',
  FORBIDDEN: 'Você não tem permissão para realizar esta ação.',
  MISSING_REGISTRATION_NUMBER: 'Informe a matrícula.',
  MISSING_CARD_HEX: 'Nenhum cartão detectado.',
  MISSING_IMAGE: 'Imagem não capturada.',
  STUDENT_NOT_FOUND: 'Aluno não encontrado no sistema acadêmico.',
  STUDENT_INACTIVE: 'Aluno inativo (Desativado/Concluído). Operação não autorizada.',
  LYCEUM_UNAVAILABLE: 'Sistema acadêmico (Lyceum) indisponível. Tente novamente em instantes.',
  SITUATOR_UNAVAILABLE: 'Sistema de carteirinhas (Situator) indisponível. Tente a matrícula manual.',
  VECTOR_AI_UNAVAILABLE: 'Sistema de reconhecimento facial indisponível. Tente outro método.',
  CARD_NOT_FOUND: 'Carteirinha não encontrada no sistema.',
  DOCUMENT_NOT_FOUND: 'Matrícula não localizada no cadastro do Situator. Atualize o cadastro.',
  FACE_NOT_RECOGNIZED: 'Aluno não identificado. Confiança insuficiente — use a matrícula manual.',
  INSUFFICIENT_BALANCE: 'Saldo insuficiente para realizar a impressão.',
  INSUFFICIENT_TOTAL_BALANCE: 'Saldo total insuficiente mesmo com empilhamento de matrículas.',
  ENTRY_NOT_FOUND: 'Lançamento não encontrado.',
  MISSING_FIELDS: 'Preencha todos os campos obrigatórios.',
  INVALID_REQUEST: 'Requisição inválida.',
  SETTING_NOT_FOUND: 'Configuração não encontrada.',
  LOGIN_ALREADY_EXISTS: 'Este login já está em uso.',
  INVALID_INPUT: 'Dados inválidos. Verifique os campos.',
  USER_NOT_FOUND: 'Usuário não encontrado.',
  NOTHING_TO_UPDATE: 'Nenhuma alteração para salvar.',
};

export function getErrorMessage(errorCode: string): string {
  if (errorCode.startsWith('INSUFFICIENT_BALANCE:')) {
    const reg = errorCode.split(':')[1];
    return `Saldo insuficiente para a matrícula ${reg}.`;
  }
  return ERROR_MESSAGES[errorCode] || `Erro inesperado (${errorCode}).`;
}

export function extractApiError(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { data?: { error?: string; message?: string } } }).response;
    const code = response?.data?.error || response?.data?.message;
    if (code) return getErrorMessage(code);
  }
  if (err instanceof Error) return err.message;
  return 'Erro desconhecido. Tente novamente.';
}
