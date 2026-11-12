// Renders the link-preview hero with the real 3D stage (see tools/og.html and README).
import { createStage } from '../src/js/scene.js';

const stage = await createStage({
  canvas: document.querySelector('.stage__canvas'),
  labelsEl: document.querySelector('.stage__labels'),
  reducedMotion: true,
  logoBase: '/public/assets/logos/',
});
document.documentElement.classList.add('has-3d');
document.querySelector('.stage').classList.add('is-on');
stage.setActive(true);
document.body.dataset.ready = 'true';
