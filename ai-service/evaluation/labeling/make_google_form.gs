/**
 * ARTI 취향 태그 라벨링 — 구글 폼 자동 생성 스크립트 (Google Apps Script)
 *
 * labeling.html 과 같은 설문(본 라벨링 40점)을 구글 폼으로 만든다. 응답은 구글 시트에 쌓이고,
 * 시트를 CSV로 내려받아 evaluation/labeling/responses/ 에 넣으면 team_tags.py 가 그대로 집계한다.
 *
 * 사용법 (README.md 「구글 폼으로 하기」 참고)
 *  1. 구글 드라이브에 폴더를 만들고 ARTI-labeling/images 의 01.jpg ~ 40.jpg 를 올린다
 *  2. 폴더 주소 https://drive.google.com/drive/folders/<여기> 의 <여기>를 아래 FOLDER_ID 에 붙여 넣는다
 *  3. script.google.com → 새 프로젝트 → 이 파일 내용을 붙여 넣고 → 함수 makeForm 실행 → 권한 허용
 *  4. 실행 로그에 나온 「응답 주소」를 팀원에게 보낸다
 *
 * 질문 제목의 [01] 같은 번호를 집계 스크립트가 읽으므로 폼을 고칠 때 번호는 지우지 않는다.
 */
const FOLDER_ID = '여기에_드라이브_폴더_ID';

// 태그 8개 — ai-service/app/tags.py 와 같은 이름 (team_tags.py 가 이 이름으로 읽는다)
const TAGS = ['풍경', '인물', '추상', '빛', '강렬한 색감', '차가운 색감', '따뜻한 색감', '부드러운 색감'];

// 그림 번호는 태그별로 5점씩 연속이라, 같은 태그가 몰려 나오지 않게 미리 섞어 둔 순서 (모든 팀원이 같은 순서)
const ORDER = ['25', '23', '31', '37', '28', '39', '05', '26', '14', '02', '17', '19', '18', '06', '24', '12', '09', '13', '36', '11',
  '16', '22', '30', '35', '34', '10', '04', '03', '20', '01', '40', '29', '32', '27', '15', '07', '38', '33', '21', '08'];

const GUIDE = [
  '풍경: 자연이나 도시 경치가 화면의 중심 (인물이 작게 있어도 배경이 주인공이면 O)',
  '인물: 사람이 주인공 (사람이 작은 점처럼 보이면 X)',
  '추상: 무엇을 그렸는지 알아보기 어려움 (단순해도 산·집·사람으로 보이면 X)',
  '빛: 빛 자체가 눈에 띔 — 햇살, 역광, 어둠 속 촛불·달빛, 강한 명암 (그냥 밝기만 하면 X)',
  '강렬한 색감: 원색, 높은 채도, 강한 색 대비 (진하지만 칙칙한 갈색·회색은 X)',
  '차가운 색감: 파랑·초록·청회색 계열이 화면의 절반 이상 (반반이면 X)',
  '따뜻한 색감: 빨강·주황·노랑·황금빛·갈색 계열이 화면의 절반 이상 (반반이면 X)',
  '부드러운 색감: 흐릿한 경계, 파스텔, 중간 이하 채도, 은은한 톤',
].join('\n');

function makeForm() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const form = FormApp.create('ARTI 취향 태그 라벨링 (40점)');
  form.setDescription(
    '그림마다 해당하는 태그를 모두 고르고, 그중 가장 대표적인 태그 1개를 골라 주세요.\n' +
    '혼자서, 다른 사람과 상의하지 말고, 첫 느낌으로 (그림당 30초~1분). 대표 태그는 「해당하는 태그」에서 고른 것 중 하나로 골라 주세요.\n\n' +
    '[태그 기준표]\n' + GUIDE,
  );
  form.setProgressBar(true);
  form.setAllowResponseEdits(true); // 회의 4단계에서 재투표할 때 자기 응답을 고칠 수 있게
  form.addTextItem().setTitle('이름').setRequired(true);

  ORDER.forEach((id, i) => {
    const file = findImage(folder, id);
    form.addPageBreakItem().setTitle(`그림 ${i + 1} / ${ORDER.length}`).setHelpText(GUIDE);
    form.addImageItem().setTitle(`그림 ${i + 1}`).setImage(file.getBlob());
    form.addCheckboxItem().setTitle(`[${id}] 해당하는 태그 (여러 개)`).setChoiceValues(TAGS).setRequired(true);
    form.addMultipleChoiceItem().setTitle(`[${id}] 대표 태그 (1개)`).setChoiceValues(TAGS).setRequired(true);
    form.addCheckboxItem().setTitle(`[${id}] 확신 없음`).setChoiceValues(['회의 때 다시 보고 싶어요']);
    form.addTextItem().setTitle(`[${id}] 메모 (선택)`);
  });

  const sheet = SpreadsheetApp.create('ARTI 취향 태그 라벨링 응답');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());
  Logger.log('응답 주소 (팀원에게 보내기): ' + form.getPublishedUrl());
  Logger.log('폼 수정 주소: ' + form.getEditUrl());
  Logger.log('응답 시트: ' + sheet.getUrl());
}

function findImage(folder, id) {
  for (const ext of ['jpg', 'png', 'jpeg', 'webp']) {
    const files = folder.getFilesByName(`${id}.${ext}`);
    if (files.hasNext()) return files.next();
  }
  throw new Error(`드라이브 폴더에 ${id}.jpg 가 없어요. images 폴더의 01.jpg ~ 40.jpg 를 모두 올려 주세요.`);
}
