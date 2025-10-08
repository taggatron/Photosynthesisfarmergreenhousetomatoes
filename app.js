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

  const WEEKS_PER_MONTH = 4;
  const TOTAL_WEEKS = MONTHS * WEEKS_PER_MONTH;

  // Helper: compute weekly growth for given inputs and week index
  function computeWeeklyGrowthFor({ temperatureC, lightsCount, co2Fans, soil, weekIndex, cloudyReductions }) {
    const monthIdx = Math.floor(weekIndex / WEEKS_PER_MONTH);
    const seasonal = 0.95 + 0.05 * Math.sin((monthIdx / 6) * Math.PI * 2);

    // Temperature factor around 24°C
    const t = temperatureC;
    let tempFactor = 0;
    if (t <= 10 || t >= 35) tempFactor = 0.05;
    else if (t <= 24) tempFactor = 0.05 + (t - 10) / (24 - 10);
    else tempFactor = 1 - (t - 24) / (35 - 24);
    tempFactor = Math.max(0.05, Math.min(1, tempFactor));

    // Lights with saturation at 2
    const l = Math.max(0, Math.min(3, lightsCount|0));
    const lightMultipliers = [1.0, 1.3, 1.6, 1.6];
    let lightFactor = lightMultipliers[l];

    // CO2 with saturation at 2
    const c = Math.max(0, Math.min(3, co2Fans|0));
    const co2Multipliers = [1.0, 1.15, 1.25, 1.25];
    const co2Factor = co2Multipliers[c];

    // Cloudy reduction for this week if any
    const reduction = cloudyReductions?.[weekIndex] || 0;
    if (reduction > 0) {
      lightFactor *= (1 - reduction);
    }

    return seasonal * tempFactor * lightFactor * co2Factor * soil;
  }

  // Optional older model kept for reference (not used in live run)
  function computeMassWeekly({ temperatureC, lightsCount, co2Fans, soil, months, cloudyWeeks }) {
    const weeks = months * WEEKS_PER_MONTH;
    let acc = 0;
    const reductions = Array.from({ length: weeks }, (_, w) => (cloudyWeeks.includes(w) ? (0.3 + Math.random() * 0.3) : 0));
    for (let w = 0; w < weeks; w++) {
      acc += computeWeeklyGrowthFor({ temperatureC, lightsCount, co2Fans, soil, weekIndex: w, cloudyReductions: reductions });
    }
    const base = 120;
    const scale = 30;
    const exp = 1.05;
    const mass = base + scale * Math.pow(acc, exp) * (0.9 + Math.random() * 0.2);
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
      cloudyReductions: [],
      accGrowth: 0,
      lastWeekComputed: -1,
      tomatoScaleTarget: 1,
    }));
  }

  let state = initState();
  let running = false;
  let timer = null;
  let startTs = 0;

  function setInteractive(enabled) {
    // Keep controls enabled even while running so mid-run changes affect outcome
    ghCards.forEach(card => {
      card.querySelectorAll('input[type="range"]').forEach(i => i.disabled = false);
      card.querySelectorAll('button[data-role="temp-dec"], button[data-role="temp-inc"], button[data-role="lights-dec"], button[data-role="lights-inc"], button[data-role="co2-dec"], button[data-role="co2-inc"]').forEach(b => b.disabled = false);
    });
    // Only manage the main buttons
    growBtn.disabled = !enabled;
    resetBtn.disabled = enabled;
  }

  function updateHardwareVisuals() {
    state.forEach((s, idx) => {
      const temp = parseInt(s.tempInput.value, 10);
  const lightsCount = parseInt(s.lightsInput.value, 10);
  const co2Count = s.co2Input ? parseInt(s.co2Input.value, 10) : 0;
      // Heater: turn on and glow strength based on temp above ambient 18
      const heaterOn = temp > 18;
      if (s.heater) {
        s.heater.classList.toggle('on', heaterOn);
        const glowStrength = Math.min(1, Math.max(0, (temp - 18) / 12));
        s.heater.style.filter = `drop-shadow(0 0 ${6 + 10 * glowStrength}px rgba(255,120,80,${0.2 + 0.6 * glowStrength}))`;
      }

      // Light: on if any lights; adjust rays opacity pulse via class
      const lightOn = lightsCount > 0;
      if (s.light) {
        s.light.classList.toggle('on', lightOn);
      }

      // CO2 fans: on if any
      const fansOn = co2Count > 0;
      if (s.co2fan) {
        s.co2fan.classList.toggle('on', fansOn);
      }

      // Live labels (if present)
      const tempLabel = s.card.querySelector('.temp-val');
      if (tempLabel) tempLabel.textContent = `${temp}°C`;
      const lightsLabel = s.card.querySelector('.lights-val');
      if (lightsLabel) lightsLabel.textContent = String(lightsCount);
      const co2Label = s.card.querySelector('.co2-val');
      if (co2Label) co2Label.textContent = String(co2Count);
    });
  }

  function resetPlants() {
    state.forEach((s, idx) => {
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
    state.forEach((s) => {
      if (s.stem) s.stem.setAttribute('transform', `scale(1,${stemScaleY.toFixed(3)})`);
      // leaves ease in from 0.3..0.8 of timeline
      s.leaves.forEach((el, i) => {
        const threshold = 0.3 + i * 0.1;
        const t = Math.max(0, Math.min(1, (progress01 - threshold) / 0.2));
        el.setAttribute('opacity', String(t));
        el.setAttribute('transform', `scale(${(0.8 + 0.2 * t).toFixed(3)})`);
      });
      // tomatoes appear late and scale towards target size
      s.tomatoes.forEach((el, i) => {
        const threshold = 0.65 + i * 0.1;
        const t = Math.max(0, Math.min(1, (progress01 - threshold) / 0.15));
        el.setAttribute('opacity', String(t));
        const baseScale = 0.6 + 0.4 * t;
        const sizeMult = 1 + (s.tomatoScaleTarget - 1) * sEase;
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
      const weeks = TOTAL_WEEKS;
      const cloudy = new Set();
      const stretches = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < stretches; k++) {
        const start = Math.floor(Math.random() * (weeks - 1));
        const len = 1 + Math.floor(Math.random() * 2);
        for (let j = 0; j < len; j++) cloudy.add(Math.min(weeks - 1, start + j));
      }
      s.cloudyWeeks = Array.from(cloudy).sort((a,b)=>a-b);
      // Precompute reductions per week for consistency across projections
      s.cloudyReductions = Array.from({ length: weeks }, (_, w) => (cloudy.has(w) ? (0.3 + Math.random() * 0.3) : 0));
      // Reset accumulators
      s.accGrowth = 0;
      s.lastWeekComputed = -1;
    });

    timer = setInterval(() => {
      const now = performance.now();
      const elapsed = now - startTs;
      const p = Math.min(1, elapsed / SIM_DURATION_MS);
      progressBar.style.width = `${Math.floor(p * 100)}%`;
      const month = Math.floor(p * MONTHS);
      progressLabel.textContent = p < 1 ? `Growing… Month ${month + 1} of ${MONTHS}` : 'Harvest ready';
      // Determine current week index
      const currentWeek = Math.min(TOTAL_WEEKS - 1, Math.floor(p * TOTAL_WEEKS));

      // Integrate weekly growth so mid-run changes affect outcome
      state.forEach(s => {
        const temp = parseInt(s.tempInput.value, 10);
        const lights = parseInt(s.lightsInput.value, 10);
        const co2 = s.co2Input ? parseInt(s.co2Input.value, 10) : 0;
        for (let w = s.lastWeekComputed + 1; w <= currentWeek; w++) {
          const wg = computeWeeklyGrowthFor({
            temperatureC: temp,
            lightsCount: lights,
            co2Fans: co2,
            soil: s.soil,
            weekIndex: w,
            cloudyReductions: s.cloudyReductions,
          });
          s.accGrowth += wg;
          s.lastWeekComputed = w;
        }
        // Project remaining weeks for live tomato sizing
        let projected = 0;
        for (let w = currentWeek + 1; w < TOTAL_WEEKS; w++) {
          projected += computeWeeklyGrowthFor({
            temperatureC: temp,
            lightsCount: lights,
            co2Fans: co2,
            soil: s.soil,
            weekIndex: w,
            cloudyReductions: s.cloudyReductions,
          });
        }
        const base = 120;
        const scale = 30;
        const exp = 1.05;
        const estMass = base + scale * Math.pow(s.accGrowth + projected, exp);
        s.tomatoScaleTarget = tomatoScaleFromMass(Math.max(120, Math.min(2200, Math.round(estMass))));
      });

      // Animate visuals for this step
      animateStep(p);

      // Update cloudy badges according to current week index
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
        // reveal masses with small stagger based on accumulated growth
        state.forEach((s, i) => {
          setTimeout(() => {
            const base = 120;
            const scale = 30;
            const exp = 1.05;
            const noise = 0.9 + Math.random() * 0.2;
            const mass = Math.max(120, Math.min(2200, Math.round(base + scale * Math.pow(s.accGrowth, exp) * noise)));
            s.massEl.textContent = formatMass(mass);
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
    card.addEventListener('click', (e) => {
      // Temperature +/-
      const tDec = e.target.closest('button[data-role="temp-dec"]');
      const tInc = e.target.closest('button[data-role="temp-inc"]');
      if (tDec || tInc) {
        const slider = card.querySelector('input[data-role="temperature"]');
        if (slider) {
          let val = parseInt(slider.value, 10);
          const min = parseInt(slider.min, 10);
          const max = parseInt(slider.max, 10);
          val += tInc ? 1 : -1;
          val = Math.max(min, Math.min(max, val));
          slider.value = String(val);
          updateHardwareVisuals();
        }
      }
      // Lights +/- (if present in DOM)
      const lDec = e.target.closest('button[data-role="lights-dec"]');
      const lInc = e.target.closest('button[data-role="lights-inc"]');
      if (lDec || lInc) {
        const slider = card.querySelector('input[data-role="lights"]');
        if (slider) {
          let val = parseInt(slider.value, 10);
          const min = parseInt(slider.min, 10);
          const max = parseInt(slider.max, 10);
          val += lInc ? 1 : -1;
          val = Math.max(min, Math.min(max, val));
          slider.value = String(val);
          updateHardwareVisuals();
        }
      }
      // CO2 fans +/- (if present in DOM)
      const cDec = e.target.closest('button[data-role="co2-dec"]');
      const cInc = e.target.closest('button[data-role="co2-inc"]');
      if (cDec || cInc) {
        const slider = card.querySelector('input[data-role="co2fans"]');
        if (slider) {
          let val = parseInt(slider.value, 10);
          const min = parseInt(slider.min, 10);
          const max = parseInt(slider.max, 10);
          val += cInc ? 1 : -1;
          val = Math.max(min, Math.min(max, val));
          slider.value = String(val);
          updateHardwareVisuals();
        }
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
