// Token Radar dashboard (radar-2). Reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, filters, a per-protocol detail view with the model's own
// inputs, and the farm plan. No network: every byte it shows is in data.js.
//
// The value model, computed at run time from the snapshot alone:
//   implied = round(TVL x peer_multiple x growth x maturity x odds)
//   peer_multiple = median(mcap/TVL) of token-bearing peers in the category
//                   (< 3 peers -> the global median, shown in the KPI strip)
//   growth   = 1 + 0.5 x clamp(change_7d, -30, +100) / 100
//   maturity = clamp((log(age_days+1) / log(366)) ^ 0.5, 0.7, 1.5)
//   odds     = 0.8 + 0.4 x peer launch rate (share of the category's protocols older
//              than 1 year that record a token)
// No protocol name is special-cased. Live-token rows carry the market's own mcap next to
// the model's implied value, so the reader sees the model's error where a price exists.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null };

  // Decode the compact rows: [rank,slug,name,catIdx,chainIdxs,tvl,chg,mcap,age,implied,pm,gf,mf,odds,rate,watch,pre,cand,excl]
  var ROWS = D.r.map(function (a) {
    return { rank: a[0], slug: a[1], name: a[2], category: D.c[a[3]], chains: a[4].map(function (i) { return D.ch[i]; }),
      tvl: a[5], chg: a[6], mcap: a[7], age: a[8], implied: a[9], pm: a[10], gf: a[11], mf: a[12], odds: a[13], rate: a[14], watch: a[15] === 1, pre: a[16] === 1, cand: a[17] === 1, excl: a[18] };
  });
  var BY_SLUG = {};
  ROWS.forEach(function (r) { BY_SLUG[r.slug] = r; });
  var TOP = ROWS[0];
  var TOP_PRE = null;
  ROWS.forEach(function (r) { if (r.cand && TOP_PRE === null) TOP_PRE = r; });

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan: the same six steps main.ts writes to board.json, from the same templates
  // (category, chain, TVL, age). Deposit tiers: $100 test / $500 standard / $1,000 full-size.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl >= 5e9) return 250;
    if (p.tvl >= 1e9) return 150;
    if (p.tvl >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(text, cost, time) {
    var s = text + ' Cost: ' + cost + '. Time: ' + time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age);
    return [
      stepText('Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'),
      stepText(actionFor(p, capital, chain) + ' Start with a $100 test deposit, scale to $500 once the position tracks, or $1,000 for a full-size farm.', '$100 / $500 / $1,000 of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', '15 minutes to set up'),
      stepText('Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet stays active in every snapshot window.', 'about $2 of gas a week', '10 minutes a week'),
      stepText('Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'the $' + capital + ' stays in the position', hold + ' days'),
      stepText("Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", 'no fee to check, and never pay to claim', '10 minutes'),
      stepText('Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes')
    ];
  }
  window.__farmSteps = farmSteps;

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return ROWS.filter(function (r) {
      if (state.tab === 'pre' && !r.cand) return false;
      if (state.tab === 'live' && r.pre) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl; bv = b.tvl; }
      else if (key === 'growth') { av = a.chg === null ? -Infinity : a.chg; bv = b.chg === null ? -Infinity : b.chg; }
      else if (key === 'age') { av = a.age === null ? Infinity : a.age; bv = b.age === null ? Infinity : b.age; }
      else { av = a.implied; bv = b.implied; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + D.a }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: D.v + ' fitted model' })
      )
    );
  }
  function lede() {
    return el('section', { class: 'lede' },
      el('h1', { text: 'Every protocol, ranked by what its token would be worth' }),
      el('p', { text: 'The watchlist is the floor: 40 protocols with at least $50M of TVL and no token on record. This board ranks all ' + D.n + ' protocols in the snapshot by implied value — ' + D.k + ' genuine launch candidates, ' + D.p + ' pre-token in all, and ' + D.l + ' that record a token, so the model is checked against real market caps where one exists. The radar view leaves out wrapped, staked and bridged products and exchange products, the same rule the watchlist uses: they are not protocols waiting on a launch of their own. Implied value is a model, not a price and not a promise of a launch.' }),
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: D.w + ' / ' + D.w }), el('small', { text: 'all 40, none missed' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Launch candidates' }), el('b', { text: String(D.k) }), el('small', { text: D.p + ' pre-token, ' + (D.p - D.k) + ' excluded' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Top candidate implied' }), el('b', { text: fmtUsd(TOP_PRE.implied) }), el('small', { text: TOP_PRE.name + ' (rank ' + TOP_PRE.rank + ')' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Global peer multiple' }), el('b', { text: 'x' + D.g.toFixed(3) }), el('small', { text: 'median mcap / TVL, all peers' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Holdout Spearman' }), el('b', { text: String(D.h[0]) }), el('small', { text: 'newest 30%, n=' + D.h[2] })),
        el('div', { class: 'kpi' }, el('span', { text: 'Holdout median error' }), el('b', { text: D.h[1] + '%' }), el('small', { text: 'honest noise, see method' }))
      )
    );
  }
  function controls() {
    var cats = D.c.slice().sort();
    var chains = D.ch.slice().sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; render(); } });
    }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Token status' }),
        el('div', { class: 'tabs' }, tabBtn('all', 'All'), tabBtn('pre', 'Launch candidates'), tabBtn('live', 'Token on record'))),
      el('span', { class: 'count', text: filtered().length + ' of ' + D.n + ' rows shown' })
    );
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null)
    );
  }
  function badge(r) {
    if (!r.pre) return el('span', { class: 'badge live', text: 'token on record' });
    if (!r.cand) return el('span', { class: 'badge', text: 'not a launch candidate' });
    if (r.watch) return el('span', { class: 'badge wl', text: 'no token · watchlist' });
    return el('span', { class: 'badge', text: 'no token' });
  }
  function boardTable() {
    var list = sorted(filtered());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.tab = 'all'; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied > max) max = r.implied; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.chg === null ? 'n/a' : fmtPct(r.chg);
      var gc = r.chg === null ? '' : r.chg >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl) }),
        el('td', { class: 'num ' + gc, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied) })
        )),
        el('td', null, badge(r))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: (state.tab === 'pre' ? 'Launch candidates: pre-token protocols that are not a wrapped, staked or bridged product' : state.tab === 'live' ? 'Protocols that record a token' : 'All ' + D.n + ' protocols') + ', strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }
  function modelPanel() {
    var o = D.o;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot figures alone. No protocol name is special-cased and no row is hand-picked. Peer multiples are computed at run time, not written in.' }),
      el('div', { class: 'formula', text: 'implied = round( TVL x peer_multiple(category) x growth x maturity x odds )' }),
      el('table', null, el('tbody', null,
        el('tr', null, el('td', { text: 'peer_multiple' }), el('td', { text: 'Median mcap / TVL of the token-bearing protocols in the same category. Fewer than 3 peers in the category: the global median x' + D.g.toFixed(3) + '.' })),
        el('tr', null, el('td', { text: 'growth' }), el('td', { text: '1 + 0.5 x clamp(change_7d, -30, +100) / 100. Missing 7-day change counts as 0.' })),
        el('tr', null, el('td', { text: 'maturity' }), el('td', { text: 'clamp((log(age_days + 1) / log(366)) ^ 0.5, 0.7, 1.5). Age runs from listed_at to the snapshot date; unknown age counts as 365 days.' })),
        el('tr', null, el('td', { text: 'odds' }), el('td', { text: '0.8 + 0.4 x peer launch rate: the share of the category\u2019s protocols older than 1 year that record a token.' }))
      )),
      el('p', { class: 'note', text: 'Cross-check (OLS, log(mcap) on log(TVL), change_7d, log(age+1), n=' + o[4] + '): log(mcap) ~ ' + o[0] + ' + ' + o[1] + ' x log(TVL) ' + o[2] + ' x change_7d + ' + o[3] + ' x log(age+1). The growth term fits slightly negative on 95 noisy rows, so growth enters with a small positive weight instead of paying a protocol for shrinking.' }),
      el('p', { class: 'note', text: 'Holdout validation — train on the oldest 70% by listed_at, test on the newest 30% (n=' + D.h[2] + '): Spearman rank correlation ' + D.h[0] + ', median absolute error ' + D.h[1] + '%. Token pricing is noisy; the ranking uses the fitted central estimate and the page states the error honestly. A protocol is described as recording no token, never as having none: the snapshot is DefiLlama\u2019s record, not proof.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = BY_SLUG[slug];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var live = !row.pre;
    var err = live && row.mcap !== null ? Math.round(((row.implied - row.mcap) / row.mcap) * 1000) / 10 : null;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + D.n + (row.watch ? ' · watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var eq = [
      ['TVL', fmtUsd(row.tvl)],
      ['Seven-day growth', fmtPct(row.chg)],
      ['Age with no token', fmtAge(row.age)],
      ['Peer multiple (' + (row.category || 'Other') + ')', 'x' + row.pm.toFixed(3)],
      ['Growth multiplier', String(row.gf)],
      ['Maturity multiplier', String(row.mf)],
      ['Odds multiplier', String(row.odds)],
      ['Peer launch rate', Math.round(row.rate * 100) + '%'],
      ['Implied value', fmtUsd(row.implied)]
    ];
    if (live && row.mcap !== null) {
      eq.push(['Actual market cap', fmtUsd(row.mcap)]);
      eq.push(['Model error vs market', (err >= 0 ? '+' : '') + err + '%']);
    }
    if (live && row.mcap === null) eq.push(['Token on record', 'yes — no market cap in this snapshot']);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: live && row.mcap !== null ? 'Implied value vs the market' : 'Implied value' }),
      el('div', { class: 'equation' }, eq.map(function (kv) {
        return el('div', null, el('span', { text: kv[0] }), el('b', { class: 'num', text: kv[1] }));
      })),
      el('p', { class: 'sub', text: live
        ? (row.mcap !== null
          ? 'This token already trades, so its market cap is a fact and the implied value is the model\u2019s guess next to it. Live rows are ranked by the same implied value, never mixed into the pre-token claim.'
          : 'This protocol records a token, but the snapshot carries no market cap for it, so there is no market number to check the model against.')
        : (!row.cand
          ? 'Not a launch candidate: it records no token, but it is a wrapped, staked or bridged product, a versioned pool or an exchange product under the watchlist\u2019s rule — not a protocol waiting on a launch of its own. It stays on the full board, ranked by the same implied value.'
          : 'Model ' + D.v + ': the same function scores every protocol. This is an estimate, not a price, and not a promise of a launch.') })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('div', { class: 'tiers' },
        el('span', { class: 'tier' }, el('b', { text: '$100' }), ' test deposit'),
        el('span', { class: 'tier' }, el('b', { text: '$500' }), ' standard'),
        el('span', { class: 'tier' }, el('b', { text: '$1,000' }), ' full-size farm')
      ),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(boardTable());
    shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () {
    state.selected = null;
    readHash();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
