import "./engine-fixtures.css";

const scenarios = [
  { language: "РУССКИЙ", title: "Смена языка", phrase: "Здравствуйте. Переключитесь на русский, пожалуйста. Мне нужно перенести встречу на четверг." },
  { language: "ENGLISH", title: "Interruption", phrase: "I need to interrupt you—please stop at the beginning, then let me correct the time to 3:30." },
  { language: "ESPAÑOL", title: "Cambio de idioma", phrase: "Por favor, cambiemos al español. Corrijo el lugar: la oficina está en la calle Oak." },
  { language: "ПЕРЕБИВАНИЯ", title: "Начало · середина · конец", phrase: "Проверьте перебивание в начале, в середине и в конце ответа; после паузы исправьте дату и попросите повторить имя." },
  { language: "ПАУЗЫ И ИСПРАВЛЕНИЯ", title: "Имя · место · время", phrase: "Пауза перед ответом, назовите имя «Мария Иванова», место встречи на Oak Street и время 3:30. Затем исправьте время на 4:15." },
];

export default function EngineFixtures() {
  return <section className="engine-fixtures" aria-label="Сценарии сравнения для Engine">
    <div className="engine-fixtures-heading"><div><span>ОБЩИЙ FIXTURE · RETELL + ENGINE / ELEVENLABS + ENGINE</span><b>Одинаковые контрольные реплики</b></div><small>Не автоматический тест</small></div>
    <div className="engine-fixtures-grid">{scenarios.map((scenario, index) => <article key={scenario.title}>
      <small>0{index + 1} · {scenario.language}</small><b>{scenario.title}</b><p>{scenario.phrase}</p>
    </article>)}</div>
  </section>;
}
