import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
const read=(p:string)=>readFileSync(p,"utf8");
it("exposes all three choices through the existing native number entry and authenticated API",()=>{
  const native=read("ios/TalkHint/UI/NumbersViewController.swift");
  expect(native).toContain('["frames", "work", "both"]');
  expect(native).toContain('"profiles.choice." + choice');
  expect(native).not.toContain("AvailableNumbersViewController()");
  const api=read("ios/TalkHint/Networking/APIClient.swift");
  expect(api).toContain("/api/call-profiles/connect");expect(api).toContain('["choice": choice]');
  expect(read("client/src/App.tsx")).toContain('<Route path="/select-number" component={CallProfiles} />');
});
it("offers the same three localized choices without a massage default in every iOS language",()=>{
  for(const language of ["en","ru","es","kk","uk"]){
    const strings=read(`ios/TalkHint/Resources/${language}.lproj/Localizable.strings`);
    for(const key of ["profiles.choice.frames","profiles.choice.work","profiles.choice.both"])
      expect(strings.match(new RegExp(`"${key.replaceAll(".","\\.")}" =`,"g"))?.length).toBe(1);
    const notice=strings.split("\n").find(s=>s.startsWith('"incoming.future_notice"'))!;
    expect(notice).not.toMatch(/massage|массаж|масаж|masaje|30/);
  }
});
