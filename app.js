// Greenhouse Growth Simulator
// Contract
// Inputs per greenhouse: temperature(10-30°C), lights count(0-3), CO2 fans(0-3), intrinsic soil factor(randomized per run)
// Simulation: 6 months compressed into ~12 seconds; progress bar reflects months; weekly stochastic cloudy events
// Output: estimated tomato mass (g) with animation of plant growth and fruit appearance

(function () {
  const MONTHS = 6;
  const SIM_DURATION_MS = 12000; // 12 seconds to simulate 6 months
  const TICK_MS = 200; // update interval

  const ghCards = Array.from(document.querySelectorAll('.greenhouse-card'));
  const growBtn = document.getElementById('growBtn');
  const resetBtn = document.getElementById('resetBtn');
  const progressBar = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');
  // Map final mass (120..2200g) to tomato visual scale (0.8..1.5)
  function tomatoScaleFromMass(mass) {
    const minM = 120, maxM = 2200;
    const minS = 0.8, maxS = 1.5;
    const n = Math.max(0, Math.min(1, (mass - minM) / (maxM - minM)));
    return minS + (maxS - minS) * n;
  }

  // Smooth ease for animation
  function easeInOutQuad(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }


  /**
   * Weekly growth model
   * - Temperature factor: peak near 24°C, triangular falloff to 0 at 10 and 35
   * - Lights factor: diminishing returns 0..3 lamps → multiplier ~ 1 + 0.3, 0.55, 0.75
   * - Soil factor: 0.85–1.15
   * - Seasonal month modifier: small sine around 1.0
   * - Cloudy weeks: reduce light factor by 30–60% when active
   * Returns total mass in grams (bounded 120–2200g)
   */
  function computeMassWeekly({ temperatureC, lightsCount, co2Fans, soil, months, cloudyWeeks }) {
    const weeks = months * 4; // coarse 4 weeks per month
    let acc = 0;
    for (let w = 0; w < weeks; w++) {
      const monthIdx = Math.floor(w / 4);
      const seasonal = 0.95 + 0.05 * Math.sin((monthIdx / 6) * Math.PI * 2);

      // Temperature factor: triangular around optimum 24°C
      const t = temperatureC;
      let tempFactor = 0;
      if (t <= 10 || t >= 35) tempFactor = 0.05;
      else if (t <= 24) tempFactor = 0.05 + (t - 10) / (24 - 10); // 0.05..1
      else tempFactor = 1 - (t - 24) / (35 - 24); // 1..0
      tempFactor = Math.max(0.05, Math.min(1, tempFactor));

      // Lights diminishing returns
  const l = Math.max(0, Math.min(3, lightsCount|0));
  // Saturate benefit at 2 lights: 2 > 1, and 3 == 2
  const lightMultipliers = [1.0, 1.3, 1.6, 1.6];
      let lightFactor = lightMultipliers[l];

      // Cloudy modifier if this week is cloudy
      const cloudy = cloudyWeeks.includes(w);
      if (cloudy) {
        const reduction = 0.3 + Math.random() * 0.3; // 30–60%
        lightFactor *= (1 - reduction);
      }

      // CO2 fans diminishing returns; saturate at 2
      const c = Math.max(0, Math.min(3, co2Fans|0));
      const co2Multipliers = [1.0, 1.15, 1.25, 1.25];
      const co2Factor = co2Multipliers[c];

      const weeklyGrowth = seasonal * tempFactor * lightFactor * co2Factor * soil;
      acc += weeklyGrowth;
    }
    // Scale accumulated growth to grams non-linearly
    const base = 120; // minimum harvest
    const scale = 280; // impacts upper bound
    const mass = base + scale * Math.pow(acc, 1.2) * (0.9 + Math.random() * 0.2);
    return Math.max(120, Math.min(2200, Math.round(mass)));
  }

  function formatMass(g) { return `${g} g`; }

  function initState() {
    return ghCards.map((card, idx) => ({
      id: card.dataset.gh,
      card,
      tempInput: card.querySelector('input[data-role="temperature"]'),
      lightsInput: card.querySelector('input[data-role="lights"]'),
  co2Input: card.querySelector('input[data-role="co2fans"]'),
      massEl: card.querySelector('.mass'),
      eventsEl: card.querySelector('.gh-events'),
      svg: card.querySelector('svg'),
      plant: card.querySelector(`#plant${idx + 1}`),
      stem: card.querySelector(`#plant${idx + 1} .stem`),
      leaves: Array.from(card.querySelectorAll(`#plant${idx + 1} .leaves ellipse`)),
      tomatoes: Array.from(card.querySelectorAll(`#plant${idx + 1} .tomatoes circle`)),
      heater: card.querySelector(`#heater${idx + 1}`),
      light: card.querySelector(`#light${idx + 1}`),
  co2fan: card.querySelector(`#co2fan${idx + 1}`),
      soil: 0.85 + Math.random() * 0.3, // 0.85 - 1.15
      cloudyWeeks: [],
      tomatoScaleTarget: 1,
    }));
  }

  let state = initState();
  let running = false;
  let timer = null;
  let startTs = 0;

  function setInteractive(enabled) {
    ghCards.forEach(card => {
      card.querySelectorAll('input[type="range"]').forEach(i => i.disabled = !enabled);
    });
    growBtn.disabled = !enabled;
    resetBtn.disabled = enabled;
  }

  function updateHardwareVisuals() {
    state.forEach((s, idx) => {
      const temp = parseInt(s.tempInput.value, 10);
      const lightsCount = parseInt(s.lightsInput.value, 10);
      const co2Count = parseInt(s.co2Input.value, 10);
      // Heater: turn on and glow strength based on temp above ambient 18
      const heaterOn = temp > 18;
      s.heater.classList.toggle('on', heaterOn);
      const glowStrength = Math.min(1, Math.max(0, (temp - 18) / 12));
      s.heater.style.filter = `drop-shadow(0 0 ${6 + 10 * glowStrength}px rgba(255,120,80,${0.2 + 0.6 * glowStrength}))`;

      // Light: on if any lights; adjust rays opacity pulse via class
      const lightOn = lightsCount > 0;
      s.light.classList.toggle('on', lightOn);

      // Duplicate bulb visuals to represent multiple lights
      const bulb = s.light.querySelector('circle');
      const group = s.light;
      // Remove any existing extra bulbs
      group.querySelectorAll('circle.extra-bulb').forEach(el => el.remove());
      if (lightOn) {
        for (let i = 1; i < lightsCount; i++) {
          const c = bulb.cloneNode(true);
          c.classList.add('extra-bulb');
          c.setAttribute('cx', String(i * 12));
          group.appendChild(c);
        }
      }
      // Update labels next to sliders
      s.card.querySelector('.temp-val').textContent = `${temp}°C`;
      s.card.querySelector('.lights-val').textContent = `${lightsCount}`;
      s.card.querySelector('.co2-val').textContent = `${co2Count}`;

      // CO2 fans visuals: spin when any, duplicate icons when >1
      const fanGroup = s.co2fan;
      fanGroup.classList.toggle('on', co2Count > 0);
      // remove extras
      const baseCircle = fanGroup.querySelector('circle');
      // Remove previous extra fans (group clones)
      fanGroup.parentNode.querySelectorAll('.co2fan.extra').forEach(el => el.remove());
      if (co2Count > 1) {
        for (let i = 1; i < co2Count; i++) {
          const clone = fanGroup.cloneNode(true);
          clone.classList.add('extra');
          clone.setAttribute('transform', `translate(${210 - i*16},140)`);
          fanGroup.parentNode.appendChild(clone);
        }
      }
    });
  }

  function resetPlants() {
    state.forEach((s, idx) => {
      // reset graphics
      if (s.stem) s.stem.setAttribute('transform', 'scale(1,0.1)');
      s.leaves.forEach(el => { el.setAttribute('opacity', '0'); el.setAttribute('transform', 'scale(0.8)'); });
      s.tomatoes.forEach(el => { el.setAttribute('opacity', '0'); el.setAttribute('transform', 'scale(0.6)'); });
      s.massEl.textContent = '—';
    });
    progressBar.style.width = '0%';
    progressLabel.textContent = 'Idle';
  }

  function animateStep(progress01) {
    // plant height 10% -> 100%
    const stemScaleY = 0.1 + 0.9 * progress01;
    const sEase = easeInOutQuad(progress01);
    state.forEach(s => {
      if (s.stem) s.stem.setAttribute('transform', `scale(1,${stemScaleY.toFixed(3)})`);
      // stagger leaves appearance
      s.leaves.forEach((el, i) => {
        const threshold = 0.25 + i * 0.2;
        const t = Math.max(0, Math.min(1, (progress01 - threshold) / 0.2));
        el.setAttribute('opacity', String(t));
        el.setAttribute('transform', `scale(${0.8 + 0.2 * t})`);
      });
      // tomatoes appear late
      s.tomatoes.forEach((el, i) => {
        const threshold = 0.65 + i * 0.1;
        const t = Math.max(0, Math.min(1, (progress01 - threshold) / 0.15));
        el.setAttribute('opacity', String(t));
        const baseScale = 0.6 + 0.4 * t; // original size ramp-in
        const sizeMult = 1 + (s.tomatoScaleTarget - 1) * sEase; // ramp towards final size target
        el.setAttribute('transform', `scale(${(baseScale * sizeMult).toFixed(3)})`);
      });
    });
  }

  function runSimulation() {
    if (running) return;
    running = true;
    setInteractive(false);
    updateHardwareVisuals();
    startTs = performance.now();

    // Generate stochastic cloudy weeks per greenhouse
    // 1-3 cloudy stretches, length 1-2 weeks each
    state.forEach(s => {
      const weeks = MONTHS * 4;
      const cloudy = new Set();
      const stretches = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < stretches; k++) {
        const start = Math.floor(Math.random() * (weeks - 1));
        const len = 1 + Math.floor(Math.random() * 2);
        for (let j = 0; j < len; j++) cloudy.add(Math.min(weeks - 1, start + j));
      }
      s.cloudyWeeks = Array.from(cloudy).sort((a,b)=>a-b);
    });

    // Precompute final masses
    const results = state.map(s => {
      const mass = computeMassWeekly({
        temperatureC: parseInt(s.tempInput.value, 10),
        lightsCount: parseInt(s.lightsInput.value, 10),
        co2Fans: parseInt(s.co2Input.value, 10),
        soil: s.soil,
        months: MONTHS,
        cloudyWeeks: s.cloudyWeeks,
      });
      return { id: s.id, mass };
    });

    // Set per-greenhouse tomato size targets from mass
    results.forEach(r => {
      const s = state.find(x => x.id === r.id);
      s.tomatoScaleTarget = tomatoScaleFromMass(r.mass);
    });

    timer = setInterval(() => {
      const now = performance.now();
      const elapsed = now - startTs;
      const p = Math.min(1, elapsed / SIM_DURATION_MS);
      progressBar.style.width = `${Math.floor(p * 100)}%`;
      const month = Math.floor(p * MONTHS);
      progressLabel.textContent = p < 1 ? `Growing… Month ${month + 1} of ${MONTHS}` : 'Harvest ready';
      animateStep(p);
      // Update cloudy badges according to current week index
      const currentWeek = Math.min(MONTHS * 4 - 1, Math.floor(p * MONTHS * 4));
      state.forEach(s => {
        const isCloudy = s.cloudyWeeks.includes(currentWeek);
        if (isCloudy) {
          s.eventsEl.innerHTML = '<span class="cloudy-badge"><span class="cloudy-dot"></span>Cloudy week: reduced light</span>';
        } else {
          s.eventsEl.innerHTML = '';
        }
      });
      if (p >= 1) {
        clearInterval(timer);
        running = false;
        // reveal masses with small stagger
        results.forEach((r, i) => {
          setTimeout(() => {
            const s = state.find(x => x.id === r.id);
            s.massEl.textContent = formatMass(r.mass);
          }, i * 200);
        });
      }
    }, TICK_MS);
  }

  function hardReset() {
    clearInterval(timer);
    running = false;
    state = initState();
    resetPlants();
    setInteractive(true);
    updateHardwareVisuals();
  }

  // Wire events
  ghCards.forEach(card => {
    card.addEventListener('input', (e) => {
      if (e.target.matches('input[type="range"]')) {
        updateHardwareVisuals();
      }
    });
  });

  growBtn.addEventListener('click', () => runSimulation());
  resetBtn.addEventListener('click', () => hardReset());

  // Initial UI state
  setInteractive(true);
  updateHardwareVisuals();
  resetPlants();
})();
