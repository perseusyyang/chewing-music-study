import { session } from '../state.js';

export function mountSetup(router) {
  const startBtn = document.getElementById('setup-start');
  const foodChoices = document.getElementById('food-choices');
  const musicChoices = document.getElementById('music-choices');

  function checkReady() {
    startBtn.disabled = !(session.food_type && session.music_genre);
  }

  foodChoices.addEventListener('change', (e) => {
    if (e.target.name === 'food') {
      session.food_type = e.target.value;
      checkReady();
    }
  });
  musicChoices.addEventListener('change', (e) => {
    if (e.target.name === 'music') {
      session.music_genre = e.target.value;
      checkReady();
    }
  });

  startBtn.addEventListener('click', () => router.navigate('/recording'));
}
