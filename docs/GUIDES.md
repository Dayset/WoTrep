# Guides — content rules and slugs

A guide teaches **one** fix. It is linked from findings (`Finding.guide` = slug) and from the guide index.

Format (`apps/web/src/content/guides/<slug>.<lang>.md` + `<slug>.json` meta):
- Title ≤ 6 words. One-sentence idea. ≤ 5 numbered steps, each ≤ 2 lines.
- One 2D clip (a `{replay, tStart, tEnd, focusVid}` reference to a fixture or shared timeline) and one drill.
- "Numbers" box: the measurable rule (e.g. "peek in the first 10 s of a 14 s reload").
- Written for both realms; tank examples available on both WG and Lesta where possible.
- RU text uses community words players actually use (размен, засвет, сведение, перезарядка, отъезд, прострел),
  not machine translation. Native-speaker review before publishing (`needs-owner` until reviewed).

| slug | topic | used by |
|---|---|---|
| why-you-died | reading your death recap | death-recap |
| autoloader-timing | counting enemy clips, spending yours | peek-into-loaded-autoloader, punished-reload, low-yield-clip |
| stay-in-support | distance to allies, when you are alone | isolated-under-fire |
| trading-hp | when a trade is worth it | bad-trade, trade-window-used |
| peek-shoot-hide | shoot then leave line of sight while reloading | exposed-while-reloading |
| first-two-minutes | don't spend HP before the battle shape is known | early-hp-dump |
| stay-useful | always have a job: spot, shoot, block, cap | idle-with-targets |
| aim-time | stop, aim, shoot | shooting-on-the-move |
| situational-awareness | zoom out, check the minimap every 5 s | sniper-tunnel-vision |
| target-priority | killshots first, then the most dangerous gun | killshot-missed |
| using-your-hp | HP is a resource; spend it when it changes the battle | survived-unused-hp |
| when-to-fall-back | reading a collapsing flank | stayed-on-collapsing-flank |
| map-opening | choosing a flank at the start | wrong-flank-at-start |
| cap-defense | when to reset, when to ignore the cap | base-cap-ignored |
| angles-and-crossfire | never be visible to two guns at once | crossfire-entered |
| arty-awareness | moving under artillery | artillery-standstill |
| lt-spotting | passive and active spotting | lt-no-spotting |
