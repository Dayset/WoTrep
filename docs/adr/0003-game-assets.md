# ADR-0003 — Game assets (maps, icons, 3D models)

Status: **proposed — needs owner decision** (issue labelled `needs-owner`)

Game models, textures and terrain belong to Wargaming / Lesta. Fan sites commonly show minimap images; hosting
ripped 3D models is a different risk level. Not legal advice — the owner decides.

**Proposal.**
1. Hosted site: minimap images (as other fan sites do) + our own SVG class icons + public API data only.
2. "In-game models and map" for 2D icons and the 3D POV: loaded **from the user's own installed client** in the browser
   (File System Access API), converted locally, cached in IndexedDB, never uploaded or shared.
3. Without a local install: simplified generic models (low-poly hull/turret by class, real dimensions where public)
   and a flat terrain plane textured with the minimap.
4. Shared links never contain extracted assets.

Revisit if Wargaming/Lesta fan-content rules change or grant permission.
