import type { ChatMessage } from '../types';

const RECENT_MESSAGES = 8;
const FIRST_REFERENCE = /대화.{0,7}시작|처음(?:에|으로)?\s*(?:봤|본|말|물|묻|짚|적|붙|부분)|첫\s*(?:질문|발화|대화|답변|감상|관찰|메모|부분)/;
const INITIAL_RECALL = /처음(?:에)?\s*(?:제가|내가)\s*(?:(?:뭘|무엇을|어디를|뭐라고)\s*(?:봤|했|말했|물었|적었)|봤|본|말한|적은|짚은|눈여겨본)/;
const PRIOR_FIRST_LOOK = /(?:아까|앞서)\s*(?:제가|내가)\s*(?:가장\s*|제일\s*)?먼저\s*(?:눈여겨본|봤|본|말한|짚은)/;
const OLDER_REFERENCE = /아까|앞서|앞에서|이전에|전에\s*(?:말|물|묻|짚|봤|본)/;
const ORDINAL_REFERENCE = /^(맨\s*(?:처음|앞(?:에)?)|[첫두세네]\s*번째|\d{1,3}\s*번째)\s*(?:(?:거|것)(?=$|[\s,.!?]|요|였|이)|이?요(?=$|[\s,.!?]))/;
const COMMON = new Set([
  '작품', '그림', '궁금했던', '말했어요', '물어봤', '설명해', '알려주세요', '주세요',
  '아까', '먼저', '처음', '부분', '어느', '어디', '관찰', '하면서', '얘기', '말한',
  '그때', '그거', '그거요', '그것', '뭐였죠', '어디였죠',
]);

function terms(text: string) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])
    .map(term => term.replace(/(?:에서|에게|으로|[은는이가을를에의와과])$/u, ''))
    .filter(term => term.length >= 2 && !COMMON.has(term));
}

export function docentHistory(messages: readonly ChatMessage[], question: string) {
  const dialogue = messages.flatMap((message, index) => {
    const answer = messages[index + 1];
    return message.role === 'user' && answer?.role === 'ai' ? [{ question: message, answer }] : [];
  });
  const eligible = dialogue.filter(({ answer }) =>
    answer.mode === 'llm' && !answer.usedVisitObservations && !answer.usedPreviousVisitMemory)
    .flatMap(pair => [pair.question, pair.answer]);
  const history = eligible.slice(-RECENT_MESSAGES).map(message => ({
    role: message.role === 'ai' ? 'assistant' as const : 'user' as const,
    text: message.text.slice(0, 1000),
  }));

  const ordinal = ORDINAL_REFERENCE.exec(question.trimStart())?.[1];
  if (ordinal) {
    const wordIndex = ['첫', '두', '세', '네'].indexOf(ordinal[0]);
    const index = ordinal.startsWith('맨') ? 0 : wordIndex >= 0 ? wordIndex : Number.parseInt(ordinal, 10) - 1;
    const target = dialogue[index]?.question;
    // Use the visible turn number, including guidance turns, without replaying their contents.
    const earlierObservations = target && eligible.includes(target) ? [target.text.slice(0, 500)] : [];
    return { history, earlierObservations, reference: 'dialogue_order' as const };
  }

  const older = eligible.slice(0, -RECENT_MESSAGES).filter(message => message.role === 'user');
  const recentText = new Set(history.map(message => message.text));
  const recallsFirst = FIRST_REFERENCE.test(question) || INITIAL_RECALL.test(question) || PRIOR_FIRST_LOOK.test(question);
  const first = recallsFirst ? older[0]?.text : undefined;
  const queryTerms = new Set(terms(question));
  const related = OLDER_REFERENCE.test(question) ? [...older].reverse().find(message =>
    !recentText.has(message.text) && terms(message.text).some(term => queryTerms.has(term)),
  )?.text : undefined;
  const earlierObservations = [...new Set([first, related])].filter((value): value is string =>
    typeof value === 'string' && Boolean(value.trim()) && !recentText.has(value),
  ).map(value => value.slice(0, 500));
  return { history, earlierObservations };
}
