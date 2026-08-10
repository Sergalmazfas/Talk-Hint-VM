import { TutorScreen } from "./_shared/TutorScreen";
export function Recording(){return <TutorScreen mode="recording" status="Слушаю…" messages={[
 {who:"emma",text:"What would you like to talk about today?",actions:true},
 {who:"user",text:"I think I would like to…"},
]}/>}
export default Recording;