import { TutorScreen } from "./_shared/TutorScreen";
export function Speaking(){return <TutorScreen mode="speaking" status="Emma говорит…" messages={[
 {who:"user",text:"I went to the park with my friends."},
 {who:"emma",text:"That sounds like a lovely way to spend the afternoon. Did you…"},
]}/>}
export default Speaking;