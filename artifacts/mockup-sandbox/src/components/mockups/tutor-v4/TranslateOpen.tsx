import { TutorScreen } from "./_shared/TutorScreen";
export function TranslateOpen(){return <TutorScreen translate messages={[
 {who:"emma",text:"Hi, Sergey! 👋 Ready for another conversation practice?",actions:true},
 {who:"user",text:"Yes, I want to talk about my weekend."},
 {who:"emma",text:"Are you ready to practise a little more conversational speech?",translation:"Готовы ещё немного попрактиковаться в разговорной речи?",actions:true},
]}/>}
export default TranslateOpen;