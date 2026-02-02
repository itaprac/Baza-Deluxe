// randomizers.js — Registry of question randomizers for computational questions

const registry = new Map();

// --- Helpers ---

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function dot(a, b) {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

function vecStr(v) {
  return `(${v.join(', ')})`;
}

function frac(num, den) {
  return `${num}/${den}`;
}

// --- Perceptron weight update: si-05-q009 ---
// w=(3,1,-2,2), x=(1,2,1,2), eta=0.5, selected for correction => y=-1
// w' = w + eta*y*x
registry.set('si-05-q009', () => {
  const dim = 4;
  const w = Array.from({ length: dim }, () => randInt(-4, 6));
  const x = Array.from({ length: dim }, () => randInt(-2, 3));
  const eta = randChoice([0.5, 1.0, 2.0]);
  const d = dot(w, x);
  // If dot >= 0, class should be +1 but it's wrong => y = -1
  // If dot < 0, class should be -1 but it's wrong => y = 1
  const y = d >= 0 ? -1 : 1;
  const wNew = w.map((wi, i) => wi + eta * y * x[i]);

  // Generate distractors
  const wWrongA = w.map((wi, i) => wi - eta * y * x[i]);
  const wWrongB = w.map((wi, i) => wi + eta * x[i]);
  const wWrongC = w.map((wi, i) => wi - eta * x[i]);

  const text = `W perceptronie prostym wag $$ w=${vecStr(w)} $$, przykład $$ x_i=${vecStr(x)} $$. Współczynnik uczenia ${eta}. Wiedząc, że przykład wybrano do poprawki, wektor wag po poprawce wynosi:`;

  return {
    text,
    answers: [
      { id: 'a', text: `$$ ${vecStr(wNew)} $$`, correct: true },
      { id: 'b', text: `$$ ${vecStr(wWrongA)} $$`, correct: false },
      { id: 'c', text: `$$ ${vecStr(wWrongB)} $$`, correct: false },
      { id: 'd', text: `$$ ${vecStr(wWrongC)} $$`, correct: false },
    ],
  };
});

// --- Perceptron dot product & class: si-05-q001 ---
// w=(6,-2,-1,3), x=(1,3,5,1), dot=-2, so y=1 (because chosen for correction and dot<0)
registry.set('si-05-q001', () => {
  const dim = 4;
  const w = Array.from({ length: dim }, () => randInt(-5, 6));
  const x = Array.from({ length: dim }, () => randInt(0, 5));
  let d = dot(w, x);
  // Ensure non-zero
  if (d === 0) { w[0] += 1; d = dot(w, x); }

  const y = d < 0 ? 1 : -1;
  const dotAbs = Math.abs(d);

  const text = `W perceptronie prostym wektor wag to $$ w = ${vecStr(w)} $$. Do poprawki wybrano przykład $$ x_t = ${vecStr(x)} $$. Iloczyn skalarny wynosi ${d}. Jeśli ten przykład został wybrany do poprawki to:`;

  return {
    text,
    answers: [
      { id: 'a', text: `etykieta klasy tego przykładu to $$ y_j = ${y} $$`, correct: true },
      { id: 'b', text: `etykieta klasy tego przykładu to $$ y_i = ${-y} $$`, correct: false },
      { id: 'c', text: 'ustalenie etykiety nie jest możliwe', correct: false },
      { id: 'd', text: 'ustalenie etykiety klasy zależy od współczynnika uczenia', correct: false },
    ],
  };
});

// --- Perceptron dot product classification check: si-05-q008 ---
registry.set('si-05-q008', () => {
  const dim = 4;
  const w = Array.from({ length: dim }, () => randInt(-4, 6));
  const x = Array.from({ length: dim }, () => randInt(-2, 4));
  const d = dot(w, x);
  if (d === 0) { w[0] += 1; }
  const dFinal = dot(w, x);
  const yLabel = dFinal >= 0 ? -1 : 1;

  const text = `W perceptronie prostym wektor wag $$ ${vecStr(w)} $$. Przykład $$ x_i = ${vecStr(x)} $$ został wybrany do poprawki. Wynika z tego, że:`;

  return {
    text,
    answers: [
      { id: 'a', text: `$$ y_i = ${yLabel} $$`, correct: true },
      { id: 'b', text: `$$ y_i = ${-yLabel} $$`, correct: false },
      { id: 'c', text: 'nie można wywnioskować klasy przykładu', correct: false },
      { id: 'd', text: 'algorytm nie zatrzyma się', correct: false },
    ],
  };
});

// --- Perceptron classification test: si-05-q018 ---
registry.set('si-05-q018', () => {
  const dim = 4;
  const w = Array.from({ length: dim }, () => randInt(-4, 5));
  const x = Array.from({ length: dim }, () => randInt(-2, 3));
  const d = dot(w, x);
  if (d === 0) { w[0] += 1; }
  const dFinal = dot(w, x);
  const y = randChoice([-1, 1]);
  const correct = (dFinal >= 0 && y === 1) || (dFinal < 0 && y === -1);

  const text = `W perceptronie prostym wektor wag $$ \\omega=${vecStr(w)} $$ jest testowany dla przykładu $$ x=${vecStr(x)} $$, $$ y=${y} $$. Można powiedzieć, że:`;

  return {
    text,
    answers: [
      { id: 'a', text: 'przykład jest poprawnie sklasyfikowany', correct: correct },
      { id: 'b', text: 'przykład jest błędnie sklasyfikowany', correct: !correct },
      { id: 'c', text: 'nie można wykonać testu', correct: false },
      { id: 'd', text: 'żadne z powyższych', correct: false },
    ],
  };
});

// --- Perceptron weight update: si-05-q022 ---
registry.set('si-05-q022', () => {
  const dim = 4;
  const w = Array.from({ length: dim }, () => randInt(-3, 5));
  const x = Array.from({ length: dim }, () => randInt(-2, 3));
  const y = randChoice([-1, 1]);
  const eta = 1.0;
  const wNew = w.map((wi, i) => wi + eta * y * x[i]);
  const wWrong = w.map((wi, i) => wi - eta * y * x[i]);

  const text = `W perceptronie prostym wektor wag $$ w=${vecStr(w)} $$ ma być poprawiony na podstawie pary uczącej $$ x=${vecStr(x)}, y=${y} $$ przy $$ \\eta=${eta} $$. Prawdziwe jest zdanie:`;

  return {
    text,
    answers: [
      { id: 'a', text: `powstanie wektor wynikowy $$ w=${vecStr(wNew)} $$`, correct: true },
      { id: 'b', text: `powstanie wektor $$ w=${vecStr(wWrong)} $$`, correct: false },
      { id: 'c', text: 'wagi się nie zmienią', correct: false },
      { id: 'd', text: 'wektor się wyzeruje', correct: false },
    ],
  };
});

// --- Perceptron weight update: si-05-q028 ---
registry.set('si-05-q028', () => {
  const dim = 4;
  const w = Array.from({ length: dim }, () => randInt(-3, 5));
  const x = Array.from({ length: dim }, () => randInt(-2, 3));
  const y = randChoice([-1, 1]);
  const eta = 1.0;
  const wNew = w.map((wi, i) => wi + eta * y * x[i]);
  const wWrongA = w.map((wi, i) => wi - eta * y * x[i]);
  const wWrongB = [...w];
  const wWrongC = w.map((wi, i) => wi + eta * x[i]);

  const text = `W perceptronie prostym wektor wag $$ w=${vecStr(w)} $$ ma być poprawiony na podstawie pary uczącej $$ x=${vecStr(x)} $$, $$ y=${y} $$ przy współczynniku uczenia $$ \\eta=${eta} $$. Nowy wektor wag:`;

  return {
    text,
    answers: [
      { id: 'a', text: `$$ ${vecStr(wNew)} $$`, correct: true },
      { id: 'b', text: `$$ ${vecStr(wWrongA)} $$`, correct: false },
      { id: 'c', text: `$$ ${vecStr(wWrongB)} $$`, correct: false },
      { id: 'd', text: `$$ ${vecStr(wWrongC)} $$`, correct: false },
    ],
  };
});

// --- Perceptron weight update with eta: si-05-q013 ---
registry.set('si-05-q013', () => {
  const dim = 4;
  const w = Array.from({ length: dim }, () => randInt(-3, 5));
  const x = Array.from({ length: dim }, () => randInt(-2, 3));
  const y = randChoice([-1, 1]);
  const eta = 0.5;
  const d = dot(w, x);
  // Ensure the example would be picked for correction (misclassified)
  const correctY = d >= 0 ? -1 : 1;
  const actualY = correctY; // Use the y that makes it a correction
  const wNew = w.map((wi, i) => wi + eta * actualY * x[i]);
  const wWrongA = w.map((wi, i) => wi - eta * actualY * x[i]);

  const text = `Załóżmy, że w perceptronie prostym wektor wag $$ w=${vecStr(w)} $$ ma zostać skorygowany na przykładzie $$ x=${vecStr(x)} $$, $$ y=${actualY} $$, przy $$ \\eta=${eta} $$. Nowy wektor wag:`;

  return {
    text,
    answers: [
      { id: 'a', text: `$$ \\omega=${vecStr(wNew)} $$`, correct: true },
      { id: 'b', text: `$$ \\omega=${vecStr(wWrongA)} $$`, correct: false },
      { id: 'c', text: 'poprawka jest niepotrzebna, bo przykład jest dobrze sklasyfikowany', correct: false },
      { id: 'd', text: 'podane informacje są niewystarczające', correct: false },
    ],
  };
});

// --- GA roulette probability: si-08-q007 ---
registry.set('si-08-q007', () => {
  const n = 4;
  const f = Array.from({ length: n }, () => randInt(0, 15));
  // Ensure at least one non-zero
  if (f.every(v => v === 0)) f[0] = randInt(1, 10);
  const sum = f.reduce((a, b) => a + b, 0);
  const probs = f.map(fi => `${fi}/${sum}`);

  const text = `W pewnym algorytmie genetycznym (maksymalizującym) mamy ${n} osobników o przystosowaniach $$ ${f.map((fi, i) => `f_${i + 1}=${fi}`).join(', ')} $$. Prawdopodobieństwo sukcesu tych osobników w selekcji ruletkowej wynosi:`;

  // Generate distractor with wrong denominators
  const wrongSum = sum + randInt(1, 5);
  const wrongProbs = f.map(fi => `${fi}/${wrongSum}`);
  const equalProbs = f.map(() => `1/${n}`);
  const wrongProbs2 = f.map((fi, i) => `${i + 1}/${n * (n + 1) / 2}`);

  return {
    text,
    answers: [
      { id: 'a', text: `$$ ${probs.join(', ')} $$`, correct: true },
      { id: 'b', text: `$$ ${wrongProbs.join(', ')} $$`, correct: false },
      { id: 'c', text: `$$ ${equalProbs.join(', ')} $$`, correct: false },
      { id: 'd', text: `$$ ${wrongProbs2.join(', ')} $$`, correct: false },
    ],
  };
});

// --- GA roulette probability: si-08-q010 ---
registry.set('si-08-q010', () => {
  const n = 4;
  const f = Array.from({ length: n }, () => randInt(1, 12));
  const sum = f.reduce((a, b) => a + b, 0);
  const probs = f.map(fi => `${fi}/${sum}`);

  const text = `W pewnym AG mamy ${n} osobników o przystosowaniach $$ ${f.map((fi, i) => `f(x_${i + 1})=${fi}`).join(', ')} $$. Odpowiadające im prawdopodobieństwa sukcesji w selekcji ruletkowej to:`;

  const maxF = Math.max(...f);
  const wrongA = f.map(fi => `${fi}/${maxF}`);
  const wrongB = f.map(() => `0`);
  wrongB[f.indexOf(maxF)] = '1';
  const wrongC = f.map((fi, i) => `${i + 1}/${n * (n + 1) / 2}`);

  return {
    text,
    answers: [
      { id: 'a', text: `$$ ${probs.join(', ')} $$`, correct: true },
      { id: 'b', text: `$$ ${wrongA.join(', ')} $$`, correct: false },
      { id: 'c', text: `$$ ${wrongB.join(', ')} $$`, correct: false },
      { id: 'd', text: `$$ ${wrongC.join(', ')} $$`, correct: false },
    ],
  };
});

// Duplicate variant: si-08-q020
registry.set('si-08-q020', () => registry.get('si-08-q010')());

// --- GA roulette expected copies: si-08-q001 ---
registry.set('si-08-q001', () => {
  const n = randChoice([4, 5, 6, 8, 10]);
  const fx = randInt(2, 20);
  const sum = fx * n + randInt(-fx * 2, fx * 4);
  const actualSum = Math.max(sum, fx + 1); // ensure sum > fx
  const expected = (fx / actualSum) * n;
  const expectedStr = Number.isInteger(expected) ? `${expected}` : expected.toFixed(1).replace(/\.0$/, '');

  const text = `W selekcji ruletkowej algorytmu genetycznego osobnik x ma przystosowanie $$ f(x)=${fx} $$, suma przystosowań populacji wynosi ${actualSum}. Liczebność populacji to ${n}. Oczekiwana liczba kopii tego osobnika po selekcji wynosi:`;

  const wrong1 = (fx / actualSum).toFixed(1);
  const wrong2 = (n / actualSum).toFixed(1);
  const wrong3 = ((fx * 2) / actualSum * n).toFixed(1);

  return {
    text,
    answers: [
      { id: 'a', text: expectedStr, correct: true },
      { id: 'b', text: wrong1, correct: false },
      { id: 'c', text: wrong2, correct: false },
      { id: 'd', text: wrong3, correct: false },
    ],
  };
});

// --- GA roulette expected copies: si-08-q011 ---
registry.set('si-08-q011', () => registry.get('si-08-q001')());

// --- GA roulette expected copies: si-08-q013 ---
registry.set('si-08-q013', () => {
  const n = 4;
  const f = Array.from({ length: n }, () => randInt(1, 10));
  const sum = f.reduce((a, b) => a + b, 0);
  const targetIdx = 0;
  const prob = f[targetIdx] / sum;
  const expected = prob * n;
  const expectedFrac = `${f[targetIdx] * n}/${sum}`;

  // Simplify if possible
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
  const g = gcd(f[targetIdx] * n, sum);
  const simpleFrac = `${(f[targetIdx] * n) / g}/${sum / g}`;

  const text = `W pewnym AG mamy ${n} osobników o przystosowaniach $$ ${f.map((fi, i) => `f(x_${i + 1})=${fi}`).join(', ')} $$. Oczekiwana liczba kopii osobnika x1 po selekcji ruletkowej wynosi:`;

  const wrongA = `${f[targetIdx]}/${n}`;
  const wrongB = `1/${n}`;

  return {
    text,
    answers: [
      { id: 'a', text: `$$ ${simpleFrac} $$`, correct: true },
      { id: 'b', text: `$$ ${wrongA} $$`, correct: false },
      { id: 'c', text: `$$ ${wrongB} $$`, correct: false },
      { id: 'd', text: `$$ ${f[targetIdx]}/${sum} $$`, correct: false },
    ],
  };
});

// --- GA roulette expected copies: si-08-q021 ---
registry.set('si-08-q021', () => registry.get('si-08-q013')());

// --- GA ranking probabilities: si-08-q012 ---
registry.set('si-08-q012', () => {
  const n = 4;
  const f = Array.from({ length: n }, () => randInt(1, 10));
  // Assign ranks: sort and rank
  const indexed = f.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(n);
  indexed.forEach((item, rankIdx) => {
    ranks[item.i] = rankIdx + 1;
  });
  const rankSum = n * (n + 1) / 2;
  const probs = ranks.map(r => `${r}/${rankSum}`);

  const text = `W pewnym AG mamy ${n} osobników o przystosowaniach $$ ${f.map((fi, i) => `f(x_${i + 1})=${fi}`).join(', ')} $$. Odpowiadające im prawdopodobieństwa sukcesji dla selekcji rankingowej wynoszą:`;

  const fSum = f.reduce((a, b) => a + b, 0);
  const wrongRouletteProbs = f.map(fi => `${fi}/${fSum}`);
  const wrongA = f.map(fi => `${fi}/${n}`);
  const wrongB = f.map(() => `0`);
  const maxF = Math.max(...f);
  wrongB[f.indexOf(maxF)] = '1';

  return {
    text,
    answers: [
      { id: 'a', text: `$$ ${probs.join(', ')} $$`, correct: true },
      { id: 'b', text: `$$ ${wrongRouletteProbs.join(', ')} $$`, correct: false },
      { id: 'c', text: `$$ ${wrongA.join(', ')} $$`, correct: false },
      { id: 'd', text: `$$ ${wrongB.join(', ')} $$`, correct: false },
    ],
  };
});

// --- GA ranking: si-08-q022 ---
registry.set('si-08-q022', () => registry.get('si-08-q012')());

// --- GA roulette statement: si-08-q017, si-08-q019 ---
function gaRouletteStatement() {
  const n = 5;
  const f = Array.from({ length: n }, () => randInt(1, 15));
  const sum = f.reduce((a, b) => a + b, 0);
  const avg = sum / n;

  // Pick a target that has clear expected copies
  const targetIdx = randInt(0, n - 1);
  const expectedCopies = (f[targetIdx] / avg);
  const expectedStr = Number.isInteger(expectedCopies) ? `${expectedCopies}` : expectedCopies.toFixed(2).replace(/\.?0+$/, '');

  const prob = f[targetIdx] / sum;
  const probStr = `${f[targetIdx]}/${sum}`;

  // Wrong expected copies for first individual
  const wrongExpected = (f[0] / sum).toFixed(2).replace(/\.?0+$/, '');

  const text = `Pewien algorytm genetyczny: $$ ${f.map((fi, i) => `f(x_${i + 1})=${fi}`).join(', ')} $$. Selekcja ruletkowa. Wskaż prawdziwe zdanie:`;

  return {
    text,
    answers: [
      { id: 'a', text: `oczekiwana liczba egzemplarzy osobnika $$ x_{${targetIdx + 1}} $$ po selekcji wynosi ${expectedStr}`, correct: true },
      { id: 'b', text: `prawdopodobieństwo selekcji osobnika $$ x_1 $$ wynosi ${f[0]}/${sum + 2}`, correct: false },
      { id: 'c', text: `osobnik o najniższym przystosowaniu nie zostanie wyselekcjonowany`, correct: false },
      { id: 'd', text: `oczekiwana liczba egzemplarzy osobnika $$ x_1 $$ wynosi ${wrongExpected}`, correct: false },
    ],
  };
}
registry.set('si-08-q017', gaRouletteStatement);
registry.set('si-08-q019', gaRouletteStatement);

// --- Alpha-beta pruning MIN node: si-04-q003 ---
registry.set('si-04-q003', () => {
  const alpha = randInt(-10, 5);
  const beta = randInt(alpha + 2, alpha + 10);

  // Generate children for MIN node: min updates beta, prunes when beta <= alpha
  const children = [];
  let currentBeta = beta;
  let pruneAfter = -1;

  for (let i = 0; i < 4; i++) {
    let val;
    if (pruneAfter === -1) {
      if (i < 2) {
        // First children: values that don't cause pruning
        val = randInt(alpha + 1, beta + 5);
        if (val < currentBeta) currentBeta = val;
        if (currentBeta <= alpha) {
          pruneAfter = i;
        }
      } else {
        // Force pruning on this child
        val = randInt(alpha - 10, alpha);
        if (val < currentBeta) currentBeta = val;
        pruneAfter = i;
      }
    } else {
      val = randInt(-20, 20);
    }
    children.push(val);
  }

  // If no pruning happened naturally, force it
  if (pruneAfter === -1) {
    children[2] = alpha - 1;
    pruneAfter = 2;
  }

  const labels = ['pierwszym potomku', 'drugim potomku', 'trzecim potomku', 'czwartym potomku'];
  const text = `W „przycinaniu alfa-beta" badany jest stan typu MIN, dla którego $$ \\alpha = ${alpha}, \\beta = ${beta} $$. Wartości zwracane ze stanów potomnych to kolejno: ${children.join(', ')}. Przycięcie nastąpi po:`;

  return {
    text,
    answers: labels.map((label, i) => ({
      id: String.fromCharCode(97 + i),
      text: label,
      correct: i === pruneAfter,
    })),
  };
});

// --- Alpha-beta MIN: si-04-q008 ---
registry.set('si-04-q008', () => registry.get('si-04-q003')());

// --- Alpha-beta MIN: si-04-q025 ---
registry.set('si-04-q025', () => registry.get('si-04-q003')());

// --- Alpha-beta pruning MAX node: si-04-q017 ---
registry.set('si-04-q017', () => {
  const alpha = randInt(-5, 10);
  const beta = alpha + 1; // tight window

  // For MAX: updates alpha. Prune when alpha >= beta
  const children = [];
  let currentAlpha = alpha;
  let pruneAfter = -1;

  for (let i = 0; i < 5; i++) {
    let val;
    if (pruneAfter === -1) {
      if (i < 2) {
        val = randInt(alpha - 5, alpha);
        if (val > currentAlpha) currentAlpha = val;
      } else {
        val = beta;
        if (val > currentAlpha) currentAlpha = val;
        pruneAfter = i;
      }
    } else {
      val = randInt(beta, beta + 5);
    }
    children.push(val);
  }

  if (pruneAfter === -1) {
    children[2] = beta;
    pruneAfter = 2;
  }

  const labels = ['pierwszym potomku', 'drugim potomku', 'trzecim potomku', 'czwartym potomku', 'piątym potomku'];
  const text = `W przycinaniu alfa-beta analizowany jest stan typu MAX, $$ \\alpha=${alpha}, \\beta=${beta} $$. Wartości potomnych: ${children.join(', ')}. Można powiedzieć, że:`;

  return {
    text,
    answers: [
      { id: 'a', text: 'Sytuacja niemożliwa', correct: false },
      { id: 'b', text: `Przycięcie po ${labels[pruneAfter >= 1 ? pruneAfter - 1 : 0]}`, correct: false },
      { id: 'c', text: `Przycięcie po ${labels[pruneAfter]}`, correct: true },
      { id: 'd', text: `Przycięcie po ${labels[Math.min(pruneAfter + 1, 4)]}`, correct: false },
    ],
  };
});

// --- Alpha-beta MAX: si-04-q029 ---
registry.set('si-04-q029', () => registry.get('si-04-q017')());

// --- Alpha-beta MAX vs MIN comparison: si-04-q009 ---
registry.set('si-04-q009', () => {
  const alpha = randInt(5, 15);
  const beta = randInt(alpha + 2, alpha + 8);
  const n = 4;
  const children = Array.from({ length: n }, () => randInt(alpha - 5, beta + 5));

  // MIN: updates beta, prune when beta <= alpha
  let betaCopy = beta;
  let minPrune = -1;
  for (let i = 0; i < n; i++) {
    if (children[i] < betaCopy) betaCopy = children[i];
    if (betaCopy <= alpha) { minPrune = i; break; }
  }

  // MAX: updates alpha, prune when alpha >= beta
  let alphaCopy = alpha;
  let maxPrune = -1;
  for (let i = 0; i < n; i++) {
    if (children[i] > alphaCopy) alphaCopy = children[i];
    if (alphaCopy >= beta) { maxPrune = i; break; }
  }

  // Determine correct answer
  let correctIdx;
  if (maxPrune === -1) {
    correctIdx = 0; // no pruning for MAX
  } else if (minPrune !== -1 && minPrune === maxPrune) {
    correctIdx = 1; // same child
  } else {
    correctIdx = 2; // different child (includes: MIN doesn't prune but MAX does)
  }

  const text = `W przycinaniu $$ \\alpha-\\beta $$ analizowany jest stan typu MAX, dla którego $$ \\alpha=${alpha}, \\beta=${beta} $$. Wartości potomnych: ${children.join(', ')}. Wtedy:`;

  return {
    text,
    answers: [
      { id: 'a', text: 'przycięcie nie nastąpi wcale', correct: correctIdx === 0 },
      { id: 'b', text: 'przycięcie nastąpi po tym samym potomku, co w stanie typu MIN', correct: correctIdx === 1 },
      { id: 'c', text: 'przycięcie nastąpi po innym potomku, co w stanie typu MIN', correct: correctIdx === 2 },
      { id: 'd', text: 'stan typu MAX nie może przybrać takich wartości', correct: false },
    ],
  };
});

// --- Alpha-beta MAX vs MIN: si-04-q026 ---
registry.set('si-04-q026', () => registry.get('si-04-q009')());

// --- Bayes log-score: si-07-q011 ---
registry.set('si-07-q011', () => {
  // Generate random probabilities that are powers of 1/2
  const nFeatures = randInt(3, 6);
  const powers = Array.from({ length: nFeatures }, () => randInt(1, 3));
  // Add prior P(Y) as power of 1/2
  const priorPower = randInt(0, 2);
  const totalPower = powers.reduce((a, b) => a + b, 0) + priorPower;
  const logScore = -totalPower;

  const probDescriptions = powers.map((p, i) => `$$ P(X_${i + 1}|Y) = (1/2)^{${p}} $$`).join(', ');
  const priorDesc = priorPower > 0 ? ` oraz $$ P(Y) = (1/2)^{${priorPower}} $$` : ' oraz $$ P(Y) = 1 $$';

  const text = `W pewnym binarnym naiwnym klasyfikatorze Bayesa użyto techniki logarytmowania (log2). Przypuśćmy, że prawdopodobieństwa warunkowe cech wynoszą ${probDescriptions}${priorDesc}. Log-score (suma log2 z prawdopodobieństw) wynosi:`;

  const wrong1 = logScore - 1;
  const wrong2 = logScore + 1;
  const wrong3 = -logScore;

  return {
    text,
    answers: [
      { id: 'a', text: `$$ ${logScore} $$`, correct: true },
      { id: 'b', text: `$$ ${wrong1} $$`, correct: false },
      { id: 'c', text: `$$ ${wrong2} $$`, correct: false },
      { id: 'd', text: `$$ (1/2)^{${totalPower}} $$`, correct: false },
    ],
  };
});

// --- RPROP 4 steps: si-06-q023 ---
registry.set('si-06-q023', () => {
  const eta0 = 0.1;
  const a = 1.2;
  const b = 0.5;
  // Random number of sign changes (0-3)
  const signChanges = randInt(0, 3);

  // Calculate final eta after 4 updates
  // Each update: if same sign => multiply by a, if sign change => multiply by b
  // With 'signChanges' changes out of 4 updates
  let eta = eta0;
  for (let i = 0; i < 4; i++) {
    if (i < (4 - signChanges)) {
      eta *= a; // no sign change
    } else {
      eta *= b; // sign change
    }
  }

  const etaFinal = eta.toFixed(4);

  const labels = ['nie zmieniały znaku', 'jednokrotnie zmieniały znak', 'dwukrotnie zmieniały znak', 'trzykrotnie zmieniały znak'];
  const text = `W algorytmie RPROP (przy domyślnych nastawach $$ \\eta_{0}=${eta0}, a=${a}, b=${b} $$) aktualny współczynnik uczenia pewnej wagi po czterech aktualizacjach wynosi $$ ${etaFinal} $$. Oznacza to, że pochodne cząstkowe:`;

  return {
    text,
    answers: labels.map((label, i) => ({
      id: String.fromCharCode(97 + i),
      text: label,
      correct: i === signChanges,
    })),
  };
});

// --- RPROP: si-06-q026 ---
registry.set('si-06-q026', () => registry.get('si-06-q023')());

// --- Safe Expression Evaluator (recursive descent, no eval) ---

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    if (expr[i] === ' ') { i++; continue; }
    if ('+-*/%(),'.includes(expr[i])) {
      tokens.push({ type: 'op', value: expr[i] });
      i++;
    } else if (/[0-9.]/.test(expr[i])) {
      let num = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i++]; }
      tokens.push({ type: 'num', value: parseFloat(num) });
    } else if (/[a-zA-Z_]/.test(expr[i])) {
      let name = '';
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) { name += expr[i++]; }
      tokens.push({ type: 'id', value: name });
    } else {
      i++; // skip unknown
    }
  }
  return tokens;
}

const FUNCTIONS = {
  // Rounding
  round: (args) => Math.round(args[0]),
  floor: (args) => Math.floor(args[0]),
  ceil:  (args) => Math.ceil(args[0]),
  trunc: (args) => Math.trunc(args[0]),
  // Basic math
  abs:   (args) => Math.abs(args[0]),
  sign:  (args) => Math.sign(args[0]),
  min:   (args) => Math.min(...args),
  max:   (args) => Math.max(...args),
  pow:   (args) => Math.pow(args[0], args[1] || 0),
  sqrt:  (args) => Math.sqrt(args[0]),
  cbrt:  (args) => Math.cbrt(args[0]),
  // Logarithms & exponential
  log:   (args) => Math.log(args[0]),
  log2:  (args) => Math.log2(args[0]),
  log10: (args) => Math.log10(args[0]),
  exp:   (args) => Math.exp(args[0]),
  // Trigonometry
  sin:   (args) => Math.sin(args[0]),
  cos:   (args) => Math.cos(args[0]),
  tan:   (args) => Math.tan(args[0]),
  asin:  (args) => Math.asin(args[0]),
  acos:  (args) => Math.acos(args[0]),
  atan:  (args) => Math.atan(args[0]),
  atan2: (args) => Math.atan2(args[0], args[1] || 0),
  // Utility
  gcd:   (args) => { let a = Math.abs(args[0]), b = Math.abs(args[1]); while (b) { [a, b] = [b, a % b]; } return a; },
  lcm:   (args) => { let a = Math.abs(args[0]), b = Math.abs(args[1]); if (a === 0 && b === 0) return 0; let g = a; let t = b; while (t) { [g, t] = [t, g % t]; } return (a / g) * b; },
  mod:   (args) => ((args[0] % args[1]) + args[1]) % args[1],
  clamp: (args) => Math.min(Math.max(args[0], args[1] || 0), args[2] !== undefined ? args[2] : Infinity),
  frac:  (args) => args[0] - Math.trunc(args[0]),
  fact:  (args) => { let n = Math.round(args[0]); if (n < 0 || n > 170) return NaN; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; },
  comb:  (args) => { let n = Math.round(args[0]), k = Math.round(args[1]); if (k < 0 || k > n || n > 170) return NaN; if (k > n - k) k = n - k; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); },
  perm:  (args) => { let n = Math.round(args[0]), k = Math.round(args[1]); if (k < 0 || k > n || n > 170) return NaN; let r = 1; for (let i = 0; i < k; i++) r *= (n - i); return r; },
};

function parseExpr(tokens, pos, vars) {
  let [left, p] = parseTerm(tokens, pos, vars);
  while (p < tokens.length && (tokens[p].value === '+' || tokens[p].value === '-')) {
    const op = tokens[p].value;
    p++;
    let right;
    [right, p] = parseTerm(tokens, p, vars);
    left = op === '+' ? left + right : left - right;
  }
  return [left, p];
}

function parseTerm(tokens, pos, vars) {
  let [left, p] = parseUnary(tokens, pos, vars);
  while (p < tokens.length && (tokens[p].value === '*' || tokens[p].value === '/' || tokens[p].value === '%')) {
    const op = tokens[p].value;
    p++;
    let right;
    [right, p] = parseUnary(tokens, p, vars);
    if (op === '*') left = left * right;
    else if (op === '/') {
      if (right === 0) throw new Error('div/0');
      left = left / right;
    }
    else left = left % right;
  }
  return [left, p];
}

function parseUnary(tokens, pos, vars) {
  if (pos < tokens.length && tokens[pos].value === '-') {
    pos++;
    let [val, p] = parsePrimary(tokens, pos, vars);
    return [-val, p];
  }
  if (pos < tokens.length && tokens[pos].value === '+') {
    pos++;
  }
  return parsePrimary(tokens, pos, vars);
}

function parsePrimary(tokens, pos, vars) {
  if (pos >= tokens.length) throw new Error('unexpected end');
  const tok = tokens[pos];

  if (tok.type === 'num') return [tok.value, pos + 1];

  if (tok.type === 'id') {
    // Check if function call
    if (pos + 1 < tokens.length && tokens[pos + 1].value === '(') {
      const fn = FUNCTIONS[tok.value];
      if (!fn) throw new Error(`unknown function: ${tok.value}`);
      pos += 2; // skip name and (
      const args = [];
      if (pos < tokens.length && tokens[pos].value !== ')') {
        let val;
        [val, pos] = parseExpr(tokens, pos, vars);
        args.push(val);
        while (pos < tokens.length && tokens[pos].value === ',') {
          pos++;
          [val, pos] = parseExpr(tokens, pos, vars);
          args.push(val);
        }
      }
      if (pos >= tokens.length || tokens[pos].value !== ')') throw new Error('missing )');
      return [fn(args), pos + 1];
    }
    // Constants
    if (tok.value === 'PI' || tok.value === 'pi') return [Math.PI, pos + 1];
    if (tok.value === 'E' || tok.value === 'e') return [Math.E, pos + 1];
    // Variable lookup
    if (tok.value in vars) return [vars[tok.value], pos + 1];
    throw new Error(`unknown variable: ${tok.value}`);
  }

  if (tok.value === '(') {
    let [val, p] = parseExpr(tokens, pos + 1, vars);
    if (p >= tokens.length || tokens[p].value !== ')') throw new Error('missing )');
    return [val, p + 1];
  }

  throw new Error(`unexpected token: ${JSON.stringify(tok)}`);
}

function evaluateExpression(expr, vars) {
  const tokens = tokenize(expr);
  if (tokens.length === 0) return NaN;
  const [result] = parseExpr(tokens, 0, vars);
  return result;
}

function formatNumber(n) {
  if (!isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  // Max 4 decimal places, strip trailing zeros
  return parseFloat(n.toFixed(4)).toString();
}

// --- Template-based randomization ---

function generateValues(randomize) {
  const vars = {};
  for (const [name, spec] of Object.entries(randomize)) {
    if (!Array.isArray(spec) || spec.length < 2) continue;
    if (spec.length === 2) {
      // [min, max] → random integer
      vars[name] = randInt(spec[0], spec[1]);
    } else {
      // [v1, v2, v3, ...] → random choice
      vars[name] = randChoice(spec);
    }
  }
  return vars;
}

function substituteVars(text, vars) {
  return text.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, name) => {
    return name in vars ? formatNumber(vars[name]) : `{${name}}`;
  });
}

function processText(text, vars) {
  // First handle ={expression} patterns
  let result = text.replace(/=\{([^}]+)\}/g, (_, expr) => {
    try {
      return formatNumber(evaluateExpression(expr, vars));
    } catch {
      return `={${expr}}`;
    }
  });
  // Then handle {var} substitutions
  result = substituteVars(result, vars);
  return result;
}

function randomizeFromTemplate(question) {
  const maxRetries = 10;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const vars = generateValues(question.randomize);

      const text = processText(question.text, vars);
      const answers = question.answers.map(a => ({
        ...a,
        text: processText(a.text, vars),
      }));
      const explanation = question.explanation
        ? processText(question.explanation, vars)
        : undefined;

      // Check for div/0 or NaN in results
      const allTexts = [text, ...answers.map(a => a.text)];
      if (allTexts.some(t => t.includes('NaN') || t.includes('Infinity'))) continue;

      return { text, answers, explanation };
    } catch {
      // Retry on errors (e.g. division by zero)
      continue;
    }
  }

  // Fallback: return original question unchanged
  return null;
}

// --- Public API ---

export function hasTemplate(question) {
  return !!(question && question.randomize && typeof question.randomize === 'object'
    && Object.keys(question.randomize).length > 0);
}

export function hasRandomizer(questionId, question = null) {
  if (registry.has(questionId)) return true;
  if (hasTemplate(question)) return true;
  return false;
}

export function randomize(questionId, question = null) {
  // Priority: hardcoded registry > template
  const gen = registry.get(questionId);
  if (gen) return gen();
  if (hasTemplate(question)) {
    return randomizeFromTemplate(question);
  }
  return null;
}
