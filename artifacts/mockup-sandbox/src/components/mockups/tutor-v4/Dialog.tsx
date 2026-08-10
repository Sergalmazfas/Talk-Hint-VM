import { TutorScreen } from "./_shared/TutorScreen";
export function Dialog(){return <TutorScreen messages={[
 {who:"emma",text:"Hi, Sergey! 👋 Ready for another conversation practice?",actions:true},
 {who:"user",text:"Yes, I want to talk about my weekend."},
 {who:"emma",text:"Great! What did you do on Saturday?",actions:true},
 {who:"user",text:"Я гулял с друзьями и смотрел новый фильм."},
 {who:"emma",text:"That sounds fun. How was the movie?",actions:true},
]}/>}
export default Dialog;