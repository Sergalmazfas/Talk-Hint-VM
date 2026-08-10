import { TutorScreen } from "./_shared/TutorScreen";
export function LongConversation(){return <TutorScreen long showLatest status="Удерживайте и говорите" messages={[
 {who:"user",text:"I usually cook dinner at home."},
 {who:"emma",text:"What is your favourite thing to cook?",actions:true},
 {who:"user",text:"Паста с овощами. Это быстро."},
 {who:"emma",text:"Vegetable pasta sounds delicious.",actions:true},
 {who:"user",text:"Do you have a favourite recipe?"},
 {who:"emma",text:"I love simple recipes with fresh ingredients.",actions:true},
 {who:"user",text:"I will try it this week."},
 {who:"emma",text:"Wonderful. Tell me how it goes!",actions:true},
]}/>}
export default LongConversation;