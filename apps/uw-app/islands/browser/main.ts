import { registerWorker } from './register.ts';

document.addEventListener('DOMContentLoaded', () => {
  void registerWorker(navigator);
});
