/* MassiDeck — pagina dei tasti (telefono, browser e PC) */
(function () {
  'use strict';

  var REPO = 'https://github.com/massxxx/massideck';
  var LINK_APK = REPO + '/releases/latest/download/MassiDeck.apk';
  var PORTA = 8765;
  var APP = !!window.DECK_APP;                       // dentro l'APK
  var host = location.hostname;
  var SUL_PC = !APP && (host === 'localhost' || host === '127.0.0.1');
  var LS = 'massideck-v1';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = function (tag, attrs, figli) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'style') e.style.cssText = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (figli || []).forEach(function (f) { if (f != null) e.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return e;
  };

  // ------------------------------------------------------------ stato locale
  var st = {};
  try { st = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { st = {}; }
  function salvaSt() { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) {} }
  if (!st.colonne) st.colonne = 'auto';
  if (st.vibrazione == null) st.vibrazione = true;
  if (st.sempreAcceso == null) st.sempreAcceso = true;

  var base = APP ? (st.base || '') : location.origin;
  var cfg = st.cfg || null;
  var pagina = st.pagina || null;
  var modifica = false;
  var collegato = false;
  var foglioAperto = false;
  var programmiCache = null;

  // ------------------------------------------------------------ rete
  function richiesta(metodo, percorso, corpo, attesa) {
    var url = base + percorso;
    var opz = { method: metodo, headers: { 'Content-Type': 'application/json' } };
    if (st.token) opz.headers['X-Deck-Token'] = st.token;
    if (corpo !== undefined) opz.body = JSON.stringify(corpo);
    var ctrl = window.AbortController ? new AbortController() : null;
    if (ctrl) opz.signal = ctrl.signal;
    return new Promise(function (ok, ko) {
      var t = setTimeout(function () { if (ctrl) ctrl.abort(); ko(new Error('Il PC non risponde')); }, attesa || 6000);
      fetch(url, opz).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          clearTimeout(t);
          if (r.status === 401) { chiediPin(); ko(new Error('PIN richiesto')); return; }
          if (!r.ok) { ko(new Error(j.errore || ('Errore ' + r.status))); return; }
          ok(j);
        });
      }).catch(function (e) { clearTimeout(t); ko(e && e.name === 'AbortError' ? new Error('Il PC non risponde') : new Error('PC non raggiungibile')); });
    });
  }

  function impostaCollegato(v) {
    collegato = v;
    var s = $('#stato');
    s.className = 'stato ' + (v ? 'ok' : 'ko');
    s.title = v ? 'Collegato al PC' : 'PC non raggiungibile';
    document.body.classList.toggle('scollegato', !v);
    aggiornaAvviso();
  }

  function aggiornaAvviso() {
    var a = $('#avviso');
    if (modifica) {
      a.hidden = false; a.className = 'modifica';
      a.textContent = 'Modifica: tocca un tasto per cambiarlo, «＋» per aggiungerne uno, il nome della pagina per rinominarla.';
    } else if (!collegato && cfg) {
      a.hidden = false; a.className = '';
      a.textContent = 'PC non raggiungibile: controlla che MassiDeck sia acceso e che siate sullo stesso Wi-Fi. Riprovo…';
    } else a.hidden = true;
  }

  function caricaConfig() {
    return richiesta('GET', '/api/config').then(function (c) {
      cfg = c; st.cfg = c; salvaSt();
      impostaCollegato(true);
      disegna();
    });
  }

  function salvaConfig() {
    st.cfg = cfg; salvaSt();
    disegna();
    return richiesta('PUT', '/api/config', cfg).then(function (r) {
      cfg.rev = r.rev; st.cfg = cfg; salvaSt();
    }).catch(function (e) { toast('Non salvato sul PC: ' + e.message); });
  }

  // controllo periodico: collegamento e modifiche fatte dall'altro lato (PC o altro telefono)
  function controlla() {
    if (!st.token && !SUL_PC) return;
    if (!base) return;
    richiesta('GET', '/api/rev', undefined, 4000).then(function (r) {
      if (!collegato) impostaCollegato(true);
      if (cfg && r.rev !== cfg.rev && !foglioAperto) return caricaConfig();
      if (!cfg) return caricaConfig();
    }).catch(function () { impostaCollegato(false); });
  }

  // ------------------------------------------------------------ disegno griglia
  function paginaAttuale() {
    if (!cfg) return null;
    var p = cfg.pagine.filter(function (x) { return x.id === pagina; })[0];
    if (!p) { p = cfg.pagine[0]; pagina = p.id; }
    return p;
  }

  function disegnaSchede() {
    var box = $('#schede');
    box.innerHTML = '';
    if (!cfg) return;
    cfg.pagine.forEach(function (p) {
      box.appendChild(el('button', {
        class: 'scheda' + (p.id === pagina ? ' attiva' : ''), text: p.nome,
        onclick: function () {
          if (modifica && p.id === pagina) return editorPagina(p);
          pagina = p.id; st.pagina = pagina; salvaSt(); disegna();
        }
      }));
    });
    if (modifica) box.appendChild(el('button', { class: 'scheda nuova', text: '＋ Pagina', onclick: nuovaPagina }));
    var att = box.querySelector('.attiva');
    if (att && att.scrollIntoView) att.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  function misura(n) {
    var g = $('#griglia');
    var gap = 10;
    var W = g.clientWidth - gap, H = g.clientHeight - gap;
    if (W <= 0 || H <= 0) return { col: 4, lato: 90 };
    if (st.colonne !== 'auto') {
      var c = +st.colonne;
      return { col: c, lato: Math.max(56, Math.floor(W / c - gap)) };
    }
    var meglio = { col: 3, lato: 0 };
    for (var col = 2; col <= 10; col++) {
      var righe = Math.max(1, Math.ceil(n / col));
      var lato = Math.min(W / col - gap, H / righe - gap);
      if (lato > meglio.lato + 0.5) meglio = { col: col, lato: lato };
    }
    meglio.lato = Math.floor(Math.min(meglio.lato, 190));
    var r = Math.max(1, Math.ceil(n / meglio.col));
    meglio.alto = Math.floor(Math.min(H / r - gap, meglio.lato * 1.35));   // riempie lo schermo in verticale
    if (meglio.lato < 64) {                     // troppi tasti: meglio scorrere
      var c2 = Math.max(3, Math.floor(W / 80));
      meglio = { col: c2, lato: Math.floor(W / c2 - gap) };
    }
    return meglio;
  }

  function faiTasto(t, lato) {
    var b = el('button', { class: 'tasto', style: '--c:' + (t.colore || '#4a5160') }, [
      el('span', { class: 'ic', text: t.icona || '⬛' }),
      t.etichetta ? el('span', { class: 'et', text: t.etichetta }) : null
    ]);
    if (lato) b.style.cssText += ';--ic:' + Math.round(lato * (t.etichetta ? 0.34 : 0.48)) + 'px;--et:' +
      Math.max(11, Math.min(16, Math.round(lato * 0.115))) + 'px';
    return b;
  }

  function disegna() {
    disegnaSchede();
    var g = $('#griglia');
    g.innerHTML = '';
    var p = paginaAttuale();
    if (!p) return;
    var n = p.tasti.length + (modifica ? 1 : 0);
    var m = misura(Math.max(n, 1));
    g.style.gridTemplateColumns = 'repeat(' + m.col + ',' + m.lato + 'px)';
    g.style.gridAutoRows = (m.alto && m.alto > m.lato ? m.alto : m.lato) + 'px';
    g.style.justifyContent = 'center';
    p.tasti.forEach(function (t, i) {
      var b = faiTasto(t, m.lato);
      b.addEventListener('click', function () { if (modifica) editorTasto(p, i); else premi(t, b); });
      g.appendChild(b);
    });
    if (modifica) {
      var piu = el('button', { class: 'tasto vuoto', style: '--ic:' + Math.round(m.lato * 0.3) + 'px', onclick: function () { editorTasto(p, -1); } },
        [el('span', { class: 'ic', text: '＋' }), el('span', { class: 'et', text: 'Aggiungi' })]);
      g.appendChild(piu);
    }
    if (!p.tasti.length && !modifica) {
      g.appendChild(el('div', { class: 'piccolo', style: 'grid-column:1/-1;text-align:center;padding:30px', text: 'Pagina vuota: tocca ✏️ per aggiungere tasti.' }));
    }
  }

  var PERICOLOSI = { spegni: 'Spegnere il PC?', riavvia: 'Riavviare il PC?', sospendi: 'Mettere il PC in sospensione?' };

  function premi(t, b) {
    var az = t.azione || {};
    if (st.vibrazione && navigator.vibrate) navigator.vibrate(18);
    var vai = function () {
      richiesta('POST', '/api/esegui', { tasto: t.id, azione: az, etichetta: t.etichetta }).then(function (r) {
        lampo(b, r.ok);
        if (!r.ok) toast('«' + (t.etichetta || 'Tasto') + '»: ' + (r.errore || 'non riuscito'));
        else if (az.tipo === 'sistema' && (az.valore === 'spegni' || az.valore === 'riavvia')) toast('Il PC si ' + (az.valore === 'spegni' ? 'spegne' : 'riavvia') + ' tra 15 secondi. Usa «Annulla spegnimento» per fermarlo.');
        impostaCollegato(true);
      }).catch(function (e) { lampo(b, false); impostaCollegato(false); toast(e.message); });
    };
    if (az.tipo === 'sistema' && PERICOLOSI[az.valore] && (!cfg || cfg.conferma_pericolosi !== false)) {
      return conferma(PERICOLOSI[az.valore], 'Sì', vai);
    }
    vai();
  }

  function lampo(b, ok) {
    b.classList.remove('ok', 'ko'); void b.offsetWidth;
    b.classList.add(ok ? 'ok' : 'ko');
    setTimeout(function () { b.classList.remove('ok', 'ko'); }, 600);
  }

  var toastT;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3200);
  }

  // ------------------------------------------------------------ fogli (finestre)
  function apriFoglio(titolo, contenuto) {
    var f = $('#foglio');
    f.innerHTML = '';
    f.appendChild(el('h2', null, [titolo, el('button', { class: 'chiudi', 'aria-label': 'Chiudi', text: '✕', onclick: chiudiFoglio })]));
    contenuto.forEach(function (c) { if (c) f.appendChild(c); });
    f.hidden = false; $('#velo').hidden = false; foglioAperto = true;
    f.scrollTop = 0;
    return f;
  }
  function chiudiFoglio() { $('#foglio').hidden = true; $('#velo').hidden = true; foglioAperto = false; }

  function conferma(domanda, si, fatto) {
    apriFoglio(domanda, [el('div', { class: 'azioni' }, [
      el('button', { class: 'sec', text: 'Annulla', onclick: chiudiFoglio, style: 'flex:1' }),
      el('button', { class: 'peri', text: si, style: 'flex:1', onclick: function () { chiudiFoglio(); fatto(); } })
    ])]);
  }

  // ------------------------------------------------------------ editor tasto
  var EMOJI = ('🎵 ⏯️ ⏮️ ⏭️ ⏹️ 🔊 🔉 🔇 📢 🎧 🎤 🎙️ 🎮 🕹️ 🌐 🔍 ✉️ 📧 📝 📊 📽️ 📄 📗 📙 📁 📂 📥 🗂️ 🗒️ 🧮 📅 🗺️ ▶️ 🎓 📹 💬 📞 📷 📸 ✂️ 🖥️ 💻 ⌨️ 🖱️ 🖨️ 📈 ⚙️ 🔧 🔌 💡 ⚡ 🔋 🔒 🔓 🌙 ⏻ 🔄 ↩️ ✍️ 👋 ✅ ❌ ⭐ ❤️ 🔥 🚀 🎯 🏠 🏫 🛒 🍕 ☕ 🚗 ✈️ 🎬 📺 📻 🎨 🧪 🔬 🤖 🧩 📌 🏁 🐍 🦊 🐱 🐶').split(' ');
  var COLORI = ['#4a5160', '#2b6cde', '#1a9bd7', '#00897b', '#1f8a4c', '#1db954', '#7cb342', '#e6a817', '#e8702a', '#d93838', '#c2185b', '#8a4fd8', '#5e35b1', '#795548', '#212121', '#b0b7c3'];

  var TIPI = [
    { id: 'programma', nome: '🖥️ Programma' },
    { id: 'sito', nome: '🌐 Sito web' },
    { id: 'cartella', nome: '📁 Cartella o file' },
    { id: 'media', nome: '🎵 Musica e volume' },
    { id: 'testo', nome: '✍️ Scrivi testo' },
    { id: 'sistema', nome: '🔒 Sistema' },
    { id: 'tasti', nome: '⌨️ Combinazione tasti' }
  ];
  var PROGRAMMI_RAPIDI = [
    ['Spotify', 'spotify:', '🎵', '#1db954'], ['Chrome', 'chrome', '🌐', '#1a9bd7'], ['Edge', 'msedge', '🌊', '#2b6cde'],
    ['Word', 'winword', '📝', '#2b6cde'], ['Excel', 'excel', '📊', '#1f8a4c'], ['PowerPoint', 'powerpnt', '📽️', '#e8702a'],
    ['Outlook', 'outlook', '📧', '#1a9bd7'], ['Esplora file', 'explorer', '📁', '#e6a817'], ['Blocco note', 'notepad', '🗒️', '#4a5160'],
    ['Calcolatrice', 'calc', '🧮', '#4a5160'], ['Paint', 'mspaint', '🎨', '#c2185b'], ['Impostazioni', 'ms-settings:', '⚙️', '#4a5160'],
    ['Prompt comandi', 'cmd', '⌨️', '#212121']
  ];
  var SITI_RAPIDI = [
    ['Google', 'https://www.google.com', '🔍'], ['Gmail', 'https://mail.google.com', '✉️'], ['Drive', 'https://drive.google.com', '🗂️'],
    ['Documenti', 'https://docs.google.com/document', '📄'], ['Fogli', 'https://docs.google.com/spreadsheets', '📗'],
    ['Presentazioni', 'https://docs.google.com/presentation', '📙'], ['Calendar', 'https://calendar.google.com', '📅'],
    ['Maps', 'https://maps.google.com', '🗺️'], ['YouTube', 'https://www.youtube.com', '▶️'], ['Classroom', 'https://classroom.google.com', '🎓'],
    ['Meet', 'https://meet.google.com', '📹'], ['Traduttore', 'https://translate.google.com', '🈯'], ['Office', 'https://www.office.com', '🏢'],
    ['YouTube Music', 'https://music.youtube.com', '🎧'], ['WhatsApp Web', 'https://web.whatsapp.com', '💬'], ['Claude', 'https://claude.ai', '🤖']
  ];
  var CARTELLE_RAPIDE = [
    ['Documenti', '%USERPROFILE%\\Documents'], ['Download', '%USERPROFILE%\\Downloads'], ['Desktop', '%USERPROFILE%\\Desktop'],
    ['Immagini', '%USERPROFILE%\\Pictures'], ['Screenshot', '%USERPROFILE%\\Pictures\\Screenshots'], ['Musica', '%USERPROFILE%\\Music'],
    ['Video', '%USERPROFILE%\\Videos'], ['Disco C:', 'C:\\']
  ];
  var MEDIA = [['play', '⏯️ Play / Pausa'], ['succ', '⏭️ Brano successivo'], ['prec', '⏮️ Brano precedente'], ['stop', '⏹️ Stop'],
    ['vol+', '🔊 Volume + (2%)'], ['vol-', '🔉 Volume − (2%)'], ['vol+10', '📢 Volume +10%'], ['vol-10', '🔈 Volume −10%'], ['muto', '🔇 Muto sì/no']];
  var SISTEMA = [['blocca', '🔒 Blocca il PC'], ['screenshot', '📸 Screenshot (salvato in Immagini › Screenshot)'], ['ritaglio', '✂️ Ritaglia una parte dello schermo'],
    ['desktop', '🖥️ Mostra desktop'], ['taskmgr', '📈 Gestione attività'], ['sospendi', '🌙 Sospendi'], ['riavvia', '🔄 Riavvia (tra 15 s)'],
    ['spegni', '⏻ Spegni (tra 15 s)'], ['annulla', '↩️ Annulla spegnimento/riavvio']];

  function generePer(az) {
    if (!az) return 'programma';
    if (az.genere) return az.genere;
    if (az.tipo !== 'apri') return az.tipo;
    var v = String(az.valore || '');
    if (/^https?:\/\//i.test(v) || /^www\./i.test(v)) return 'sito';
    if (/[\\\/%]/.test(v) || /^[a-z]:/i.test(v)) return 'cartella';
    return 'programma';
  }

  function editorTasto(p, indice) {
    var nuovo = indice < 0;
    var orig = nuovo ? null : p.tasti[indice];
    var t = JSON.parse(JSON.stringify(orig || { etichetta: '', icona: '⭐', colore: '#2b6cde', azione: { tipo: 'apri', valore: '', genere: 'programma' } }));
    if (!t.id) t.id = Math.random().toString(16).slice(2, 10);
    var genere = generePer(t.azione);

    var prev = el('div', { class: 'anteprima' });
    function aggPrev() { prev.innerHTML = ''; prev.appendChild(faiTasto(t, 110)); }

    var inNome = el('input', { value: t.etichetta || '', maxlength: '30', placeholder: 'es. Spotify' });
    inNome.addEventListener('input', function () { t.etichetta = inNome.value; aggPrev(); });

    var inIcona = el('input', { value: t.icona || '', maxlength: '4', placeholder: 'emoji', style: 'width:90px;text-align:center;font-size:22px' });
    var grigliaEmoji = el('div', { class: 'emoji' });
    function aggEmoji() {
      grigliaEmoji.innerHTML = '';
      EMOJI.forEach(function (e) {
        grigliaEmoji.appendChild(el('button', { class: e === t.icona ? 'sel' : '', text: e, onclick: function () { t.icona = e; inIcona.value = e; aggEmoji(); aggPrev(); } }));
      });
    }
    inIcona.addEventListener('input', function () { t.icona = inIcona.value.trim(); aggEmoji(); aggPrev(); });

    var colori = el('div', { class: 'colori' });
    function aggColori() {
      colori.innerHTML = '';
      COLORI.forEach(function (c) {
        colori.appendChild(el('button', { class: c === t.colore ? 'sel' : '', style: 'background:' + c, 'aria-label': c, onclick: function () { t.colore = c; aggColori(); aggPrev(); } }));
      });
    }

    var tipi = el('div', { class: 'tipi' });
    var dettagli = el('div', { class: 'campo' });

    function proponi(nome, icona, colore) {   // riempie nome e icona se ancora vuoti/di base
      if (!inNome.value.trim() || t._auto) { t.etichetta = nome; inNome.value = nome; t._auto = true; }
      if (icona && (!t.icona || t.icona === '⭐' || t._autoIc)) { t.icona = icona; inIcona.value = icona; t._autoIc = true; aggEmoji(); }
      if (colore && t._autoCol !== false && (t._autoCol || nuovo)) { t.colore = colore; t._autoCol = true; aggColori(); }
      aggPrev();
    }
    inNome.addEventListener('input', function () { t._auto = false; });

    function aggTipi() {
      tipi.innerHTML = '';
      TIPI.forEach(function (x) {
        tipi.appendChild(el('button', { class: x.id === genere ? 'sel' : '', text: x.nome, onclick: function () {
          if (genere === x.id) return;
          genere = x.id;
          var vuoto = { programma: ['apri', ''], sito: ['apri', 'https://'], cartella: ['apri', ''], media: ['media', 'play'], testo: ['testo', ''], sistema: ['sistema', 'blocca'], tasti: ['tasti', ''] }[x.id];
          t.azione = { tipo: vuoto[0], valore: vuoto[1], genere: x.id };
          aggTipi(); aggDettagli();
        } }));
      });
    }

    function sceltaDaLista(voci, attuale, scegli) {
      var box = el('div', { class: 'lista' });
      voci.forEach(function (v) {
        box.appendChild(el('button', { class: v[0] === attuale ? 'sel' : '', text: v[1], onclick: function () { scegli(v); } }));
      });
      return box;
    }

    function aggDettagli() {
      dettagli.innerHTML = '';
      var az = t.azione;
      var inVal;
      if (genere === 'programma') {
        inVal = el('input', { value: az.valore || '', placeholder: 'nome o percorso, es. chrome oppure C:\\…\\gioco.exe' });
        inVal.addEventListener('input', function () { az.valore = inVal.value; });
        var chips = el('div', { class: 'chips' });
        PROGRAMMI_RAPIDI.forEach(function (pr) {
          chips.appendChild(el('button', { class: az.valore === pr[1] ? 'sel' : '', text: pr[2] + ' ' + pr[0], onclick: function () {
            az.valore = pr[1]; inVal.value = pr[1]; proponi(pr[0], pr[2], pr[3]); aggDettagli();
          } }));
        });
        var cerca = el('input', { placeholder: '🔎 Cerca tra i programmi installati sul PC…' });
        var lista = el('div', { class: 'lista', style: 'max-height:200px' });
        var mostra = function () {
          lista.innerHTML = '';
          if (!programmiCache) { lista.appendChild(el('div', { class: 'piccolo', style: 'padding:10px', text: 'Carico i programmi dal PC…' })); return; }
          var q = cerca.value.trim().toLowerCase();
          var tro = programmiCache.filter(function (x) { return !q || x.nome.toLowerCase().indexOf(q) >= 0; }).slice(0, 80);
          if (!tro.length) lista.appendChild(el('div', { class: 'piccolo', style: 'padding:10px', text: 'Nessun programma trovato.' }));
          tro.forEach(function (x) {
            lista.appendChild(el('button', { class: az.valore === x.percorso ? 'sel' : '', text: x.nome, onclick: function () {
              az.valore = x.percorso; inVal.value = x.percorso; proponi(x.nome, '🖥️'); mostra();
            } }));
          });
        };
        cerca.addEventListener('input', mostra);
        dettagli.appendChild(el('span', { class: 'tit', text: 'Programma da aprire' }));
        dettagli.appendChild(inVal);
        dettagli.appendChild(chips);
        dettagli.appendChild(el('div', { style: 'height:12px' }));
        dettagli.appendChild(cerca);
        dettagli.appendChild(lista);
        mostra();
        if (!programmiCache) richiesta('GET', '/api/programmi').then(function (r) { programmiCache = r.programmi || []; mostra(); })
          .catch(function () { lista.innerHTML = ''; lista.appendChild(el('div', { class: 'piccolo', style: 'padding:10px', text: 'Elenco non disponibile: il PC non risponde.' })); });
      } else if (genere === 'sito') {
        inVal = el('input', { value: az.valore || '', inputmode: 'url', placeholder: 'https://…' });
        inVal.addEventListener('input', function () { az.valore = inVal.value; });
        var chS = el('div', { class: 'chips' });
        SITI_RAPIDI.forEach(function (s) {
          chS.appendChild(el('button', { class: az.valore === s[1] ? 'sel' : '', text: s[2] + ' ' + s[0], onclick: function () {
            az.valore = s[1]; inVal.value = s[1]; proponi(s[0], s[2]); aggDettagli();
          } }));
        });
        dettagli.appendChild(el('span', { class: 'tit', text: 'Indirizzo del sito (si apre nel browser del PC)' }));
        dettagli.appendChild(inVal); dettagli.appendChild(chS);
      } else if (genere === 'cartella') {
        inVal = el('input', { value: az.valore || '', placeholder: 'es. C:\\Scuola\\Progetti oppure un file' });
        inVal.addEventListener('input', function () { az.valore = inVal.value; });
        var chC = el('div', { class: 'chips' });
        CARTELLE_RAPIDE.forEach(function (c) {
          chC.appendChild(el('button', { class: az.valore === c[1] ? 'sel' : '', text: '📂 ' + c[0], onclick: function () {
            az.valore = c[1]; inVal.value = c[1]; proponi(c[0], '📂', '#e6a817'); aggDettagli();
          } }));
        });
        dettagli.appendChild(el('span', { class: 'tit', text: 'Cartella o file da aprire sul PC' }));
        dettagli.appendChild(inVal); dettagli.appendChild(chC);
        dettagli.appendChild(el('div', { class: 'nota', text: 'Suggerimento: in Esplora file tieni premuto Maiusc, clic destro sul file › «Copia come percorso», poi incollalo qui dal PC.' }));
      } else if (genere === 'media') {
        dettagli.appendChild(el('span', { class: 'tit', text: 'Comando musica / volume (vale per Spotify, YouTube e gli altri lettori)' }));
        dettagli.appendChild(sceltaDaLista(MEDIA, az.valore, function (v) {
          az.valore = v[0]; var parti = v[1].split(' '); proponi(parti.slice(1).join(' ').replace(/\s*\(.*\)/, ''), parti[0]); aggDettagli();
        }));
      } else if (genere === 'sistema') {
        dettagli.appendChild(el('span', { class: 'tit', text: 'Comando del PC' }));
        dettagli.appendChild(sceltaDaLista(SISTEMA, az.valore, function (v) {
          az.valore = v[0]; var parti = v[1].split(' '); proponi(parti.slice(1).join(' ').replace(/\s*\(.*\)/, ''), parti[0]); aggDettagli();
        }));
      } else if (genere === 'testo') {
        inVal = el('textarea', { rows: '4', placeholder: 'Il testo viene scritto dove si trova il cursore sul PC' });
        inVal.value = az.valore || '';
        inVal.addEventListener('input', function () { az.valore = inVal.value; });
        dettagli.appendChild(el('span', { class: 'tit', text: 'Testo da scrivere' }));
        dettagli.appendChild(inVal);
        dettagli.appendChild(el('div', { class: 'nota', text: 'Utile per email, firme, saluti, codici che scrivi spesso. Gli «a capo» vengono premuti come Invio.' }));
      } else if (genere === 'tasti') {
        inVal = el('input', { value: az.valore || '', placeholder: 'es. ctrl+shift+t', autocapitalize: 'off' });
        inVal.addEventListener('input', function () { az.valore = inVal.value; });
        var chT = el('div', { class: 'chips' });
        [['ctrl+c', 'Copia'], ['ctrl+v', 'Incolla'], ['ctrl+z', 'Annulla'], ['alt+tab', 'Cambia finestra'], ['alt+f4', 'Chiudi finestra'],
          ['ctrl+shift+t', 'Riapri scheda'], ['win+e', 'Esplora file'], ['win+l', 'Blocca'], ['f11', 'Schermo intero']].forEach(function (k) {
          chT.appendChild(el('button', { text: k[1] + ' · ' + k[0], onclick: function () { az.valore = k[0]; inVal.value = k[0]; proponi(k[1], '⌨️'); } }));
        });
        dettagli.appendChild(el('span', { class: 'tit', text: 'Combinazione da premere' }));
        dettagli.appendChild(inVal); dettagli.appendChild(chT);
        dettagli.appendChild(el('div', { class: 'nota', text: 'Tasti: ctrl, alt, shift, win, invio, esc, tab, spazio, canc, f1…f12, frecce (su, giu, sinistra, destra), lettere e numeri. Uniscili con «+».' }));
      }
    }

    function valido() {
      var az = t.azione;
      if (az.tipo === 'apri') {
        var v = String(az.valore || '').trim();
        if (!v || v === 'https://') { toast('Scegli cosa aprire'); return false; }
        if (genere === 'sito' && !/^[a-z][a-z0-9+.-]*:/i.test(v)) az.valore = 'https://' + v;
        az.genere = genere;
      }
      if ((az.tipo === 'testo' || az.tipo === 'tasti') && !String(az.valore || '').trim()) { toast(az.tipo === 'testo' ? 'Scrivi il testo' : 'Scrivi la combinazione'); return false; }
      return true;
    }
    function pulito() { var c = JSON.parse(JSON.stringify(t)); delete c._auto; delete c._autoIc; delete c._autoCol; return c; }

    var bottoni = el('div', { class: 'azioni' }, [
      el('button', { class: 'sec', text: '▶ Prova', onclick: function () {
        if (!valido()) return;
        richiesta('POST', '/api/esegui', { azione: t.azione, etichetta: t.etichetta }).then(function (r) { toast(r.ok ? 'Fatto ✓' : ('Non riuscito: ' + r.errore)); })
          .catch(function (e) { toast(e.message); });
      } }),
      el('button', { class: 'pri', text: nuovo ? 'Aggiungi' : 'Salva', onclick: function () {
        if (!valido()) return;
        if (nuovo) p.tasti.push(pulito()); else p.tasti[indice] = pulito();
        chiudiFoglio(); salvaConfig();
      } })
    ]);
    var altri = null;
    if (!nuovo) {
      var sposta = function (d) {
        var j = indice + d; if (j < 0 || j >= p.tasti.length) return;
        var x = p.tasti.splice(indice, 1)[0]; p.tasti.splice(j, 0, x);
        chiudiFoglio(); salvaConfig();
      };
      var selPag = el('select', null, cfg.pagine.map(function (pg) { var o = el('option', { value: pg.id, text: pg.nome }); if (pg.id === p.id) o.selected = true; return o; }));
      selPag.addEventListener('change', function () {
        var dest = cfg.pagine.filter(function (pg) { return pg.id === selPag.value; })[0];
        if (!dest || dest === p) return;
        dest.tasti.push(p.tasti.splice(indice, 1)[0]);
        chiudiFoglio(); salvaConfig(); toast('Spostato in «' + dest.nome + '»');
      });
      altri = el('div', null, [
        el('div', { class: 'azioni' }, [
          el('button', { class: 'sec', text: '◀ Sposta prima', onclick: function () { sposta(-1); }, style: 'flex:1' }),
          el('button', { class: 'sec', text: 'Sposta dopo ▶', onclick: function () { sposta(1); }, style: 'flex:1' }),
          el('button', { class: 'sec', text: '⧉ Duplica', onclick: function () {
            var c = pulito(); c.id = Math.random().toString(16).slice(2, 10); p.tasti.splice(indice + 1, 0, c); chiudiFoglio(); salvaConfig();
          }, style: 'flex:1' })
        ]),
        el('label', { style: 'margin-top:12px' }, ['Sposta in un\'altra pagina', selPag]),
        el('div', { class: 'azioni' }, [el('button', { class: 'peri', text: '🗑 Elimina tasto', style: 'flex:1', onclick: function () {
          conferma('Eliminare «' + (t.etichetta || 'tasto') + '»?', 'Elimina', function () { p.tasti.splice(indice, 1); salvaConfig(); });
        } })])
      ]);
    }

    aggPrev(); aggEmoji(); aggColori(); aggTipi(); aggDettagli();
    apriFoglio(nuovo ? 'Nuovo tasto' : 'Modifica tasto', [
      prev,
      el('div', { class: 'campo' }, [el('span', { class: 'tit', text: 'Cosa fa' }), tipi]),
      dettagli,
      el('div', { class: 'campo' }, [el('span', { class: 'tit', text: 'Nome sul tasto' }), inNome]),
      el('div', { class: 'campo' }, [el('span', { class: 'tit', text: 'Icona' }), el('div', { class: 'riga', style: 'justify-content:flex-start' }, [inIcona, el('span', { class: 'piccolo', text: 'scrivi un\'emoji o sceglila qui sotto' })]), grigliaEmoji]),
      el('div', { class: 'campo' }, [el('span', { class: 'tit', text: 'Colore' }), colori]),
      bottoni, altri
    ]);
  }

  // ------------------------------------------------------------ pagine
  function nuovaPagina() {
    var nome = el('input', { placeholder: 'es. Scuola, Giochi, Arduino…', maxlength: '24' });
    apriFoglio('Nuova pagina', [nome, el('div', { class: 'azioni' }, [el('button', { class: 'pri', text: 'Crea', onclick: function () {
      var n = nome.value.trim(); if (!n) return toast('Scrivi un nome');
      var p = { id: Math.random().toString(16).slice(2, 10), nome: n, tasti: [] };
      cfg.pagine.push(p); pagina = p.id; st.pagina = pagina; chiudiFoglio(); salvaConfig();
    } })])]);
    setTimeout(function () { nome.focus(); }, 100);
  }

  function editorPagina(p) {
    var i = cfg.pagine.indexOf(p);
    var nome = el('input', { value: p.nome, maxlength: '24' });
    var sposta = function (d) {
      var j = i + d; if (j < 0 || j >= cfg.pagine.length) return;
      cfg.pagine.splice(i, 1); cfg.pagine.splice(j, 0, p); chiudiFoglio(); salvaConfig();
    };
    apriFoglio('Pagina', [
      el('label', null, ['Nome', nome]),
      el('div', { class: 'azioni' }, [
        el('button', { class: 'sec', text: '◀ Prima', style: 'flex:1', onclick: function () { sposta(-1); } }),
        el('button', { class: 'sec', text: 'Dopo ▶', style: 'flex:1', onclick: function () { sposta(1); } })
      ]),
      el('div', { class: 'azioni' }, [
        cfg.pagine.length > 1 ? el('button', { class: 'peri', text: '🗑 Elimina pagina', onclick: function () {
          conferma('Eliminare la pagina «' + p.nome + '» e i suoi ' + p.tasti.length + ' tasti?', 'Elimina', function () {
            cfg.pagine.splice(cfg.pagine.indexOf(p), 1); pagina = cfg.pagine[0].id; salvaConfig();
          });
        } }) : null,
        el('button', { class: 'pri', text: 'Salva', onclick: function () {
          var n = nome.value.trim(); if (!n) return toast('Scrivi un nome');
          p.nome = n; chiudiFoglio(); salvaConfig();
        } })
      ])
    ]);
  }

  function attivaModifica(v) {
    modifica = v;
    document.body.classList.toggle('modifica', v);
    $('#b-modifica').classList.toggle('acceso', v);
    $('#b-modifica').textContent = v ? '✔️' : '✏️';
    aggiornaAvviso();
    disegna();
  }

  // ------------------------------------------------------------ impostazioni
  function impostazioni() {
    var interr = function (testo, val, cambia) {
      var c = el('input', { type: 'checkbox' }); c.checked = !!val;
      c.addEventListener('change', function () { cambia(c.checked); });
      return el('label', { class: 'interr' }, [el('span', { text: testo }), c]);
    };
    var seg = el('div', { class: 'seg' });
    ['auto', '3', '4', '5', '6'].forEach(function (v) {
      seg.appendChild(el('button', { class: String(st.colonne) === v ? 'sel' : '', text: v === 'auto' ? 'Auto' : v, onclick: function () {
        st.colonne = v; salvaSt(); disegna(); impostazioni();
      } }));
    });
    var info = SUL_PC ? 'Questo PC' : (base.replace(/^https?:\/\//, '') || '—');
    apriFoglio('Impostazioni', [
      el('div', { class: 'interr' }, [el('span', { text: 'Colonne di tasti' }), seg]),
      interr('Vibrazione quando premi', st.vibrazione, function (v) { st.vibrazione = v; salvaSt(); }),
      interr('Schermo sempre acceso', st.sempreAcceso, function (v) { st.sempreAcceso = v; salvaSt(); schermoAcceso(); }),
      interr('Chiedi conferma per spegni/riavvia', !cfg || cfg.conferma_pericolosi !== false, function (v) { cfg.conferma_pericolosi = v; salvaConfig(); }),
      el('div', { class: 'interr' }, [el('span', { text: 'Collegato a' }), el('b', { text: info })]),
      el('div', { class: 'azioni' }, [
        SUL_PC ? null : el('button', { class: 'sec', text: '🔌 Scollega / cambia PC', onclick: function () {
          st.token = ''; salvaSt(); chiudiFoglio(); chiediPin(true);
        } }),
        el('button', { class: 'sec', text: '🔄 Ricarica', onclick: function () { location.reload(); } }),
        el('button', { class: 'peri', text: 'Rimetti i tasti di partenza', onclick: function () {
          conferma('Cancellare tutti i tuoi tasti e rimettere quelli di partenza?', 'Sì, ripristina', function () {
            richiesta('POST', '/api/ripristina', {}).then(caricaConfig).catch(function (e) { toast(e.message); });
          });
        } })
      ]),
      APP || SUL_PC ? null : el('div', { class: 'nota', html: 'Per usarla come un\'app: nel menu del browser scegli <b>«Aggiungi a schermata Home»</b>. Su Android c\'è anche l\'app: <a style="color:#8fb4ff" href="' + LINK_APK + '">scarica MassiDeck.apk</a>.' }),
      el('div', { class: 'nota', text: 'MassiDeck — tasti sincronizzati tra telefono e PC.' })
    ]);
  }

  // ------------------------------------------------------------ schermo acceso / intero
  var blocco = null;
  function schermoAcceso() {
    if (!st.sempreAcceso) { if (blocco) { blocco.release(); blocco = null; } return; }
    if (navigator.wakeLock && document.visibilityState === 'visible') {
      navigator.wakeLock.request('screen').then(function (b) { blocco = b; }).catch(function () {});
    }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { schermoAcceso(); controlla(); } });

  // ------------------------------------------------------------ collegamento
  function chiediPin(forzaIndirizzo) {
    if (SUL_PC) return;
    var s = $('#collega');
    if (!s.hidden) return;
    s.hidden = false;
    $('#collega-indirizzo').hidden = !APP;
    if (APP && st.base) $('#in-ip').value = st.base.replace(/^https?:\/\//, '').replace(':' + PORTA, '');
    $('#collega-errore').textContent = '';
    if (!forzaIndirizzo && APP && st.base) setTimeout(function () { $('#in-pin').focus(); }, 200);
  }

  function normalizzaIndirizzo(v) {
    v = v.trim().replace(/\/+$/, '');
    if (!v) return '';
    if (!/^https?:\/\//.test(v)) v = 'http://' + v;
    if (!/:\d+$/.test(v.replace(/^https?:\/\//, ''))) v += ':' + PORTA;
    return v;
  }

  function collega(pin) {
    var err = $('#collega-errore');
    err.textContent = '';
    if (APP) {
      var b = normalizzaIndirizzo($('#in-ip').value);
      if (!b) { err.textContent = 'Scrivi l\'indirizzo del PC o usa «Cerca»'; return; }
      base = b;
    }
    if (!/^\d{4}$/.test(pin)) { err.textContent = 'Il PIN è di 4 cifre'; return; }
    var btn = $('#b-collega'); btn.disabled = true; btn.textContent = 'Collego…';
    st.token = '';
    richiesta('POST', '/api/accedi', { pin: pin, nome: navigator.userAgent.replace(/^.*?\(([^)]*)\).*$/, '$1').slice(0, 40) }).then(function (r) {
      st.token = r.token; if (APP) st.base = base; salvaSt();
      $('#collega').hidden = true; $('#in-pin').value = '';
      toast('Collegato a ' + r.nome + ' ✓');
      return caricaConfig();
    }).catch(function (e) {
      err.textContent = e.message === 'PC non raggiungibile' || e.message === 'Il PC non risponde'
        ? 'Non trovo MassiDeck a quell\'indirizzo. È acceso? Il firewall di Windows lo lascia passare? Siete sullo stesso Wi-Fi?' : e.message;
    }).then(function () { btn.disabled = false; btn.textContent = 'Collega'; });
  }

  // ricerca del PC sulla rete di casa (solo app)
  var cercando = false;
  function cercaPC() {
    if (cercando) return;
    cercando = true;
    var stato = $('#cerca-stato');
    var reti = ['192.168.1', '192.168.0', '192.168.178', '192.168.2', '192.168.100', '10.0.0', '192.168.10', '192.168.50'];
    var scritta = $('#in-ip').value.trim().match(/^(\d+\.\d+\.\d+)\./);
    if (scritta) reti.unshift(scritta[1]);
    var coda = [];
    reti.forEach(function (r) { for (var i = 1; i < 255; i++) coda.push(r + '.' + i); });
    var totale = coda.length, fatti = 0, trovato = null, attivi = 0;
    function prova(ip) {
      return new Promise(function (ok) {
        var ctrl = window.AbortController ? new AbortController() : null;
        var t = setTimeout(function () { if (ctrl) ctrl.abort(); ok(null); }, 1500);
        fetch('http://' + ip + ':' + PORTA + '/api/ping', ctrl ? { signal: ctrl.signal } : {}).then(function (r) { return r.json(); })
          .then(function (j) { clearTimeout(t); ok(j && j.app === 'MassiDeck' ? { ip: ip, nome: j.nome } : null); })
          .catch(function () { clearTimeout(t); ok(null); });
      });
    }
    function prossimo() {
      if (trovato || !coda.length) {
        if (attivi === 0) fine();
        return;
      }
      var ip = coda.shift(); attivi++;
      prova(ip).then(function (r) {
        attivi--; fatti++;
        if (r && !trovato) { trovato = r; }
        if (fatti % 20 === 0) stato.textContent = 'Cerco… ' + Math.round(fatti / totale * 100) + '%';
        prossimo();
      });
    }
    function fine() {
      if (!cercando) return;
      cercando = false;
      if (trovato) {
        $('#in-ip').value = trovato.ip;
        stato.textContent = '✓ Trovato «' + trovato.nome + '» (' + trovato.ip + '). Ora scrivi il PIN.';
        $('#in-pin').focus();
      } else stato.textContent = 'Non trovato. Scrivi l\'indirizzo che vedi sulla pagina di MassiDeck del PC.';
    }
    stato.textContent = 'Cerco…';
    for (var k = 0; k < 48; k++) prossimo();
  }

  // ------------------------------------------------------------ pannello del PC
  function pannelloPC() {
    var box = $('#pannello-pc');
    box.hidden = false;
    var ultimo = '';
    function aggiorna() {
      richiesta('GET', '/api/pc').then(function (d) {
        var firma = JSON.stringify([d.pin, d.ip, d.avvio, d.telefoni]);
        var reg = (d.registro || []).slice().reverse().join('\n') || '—';
        if (firma === ultimo) { var r = box.querySelector('.registro'); if (r) r.textContent = reg; return; }
        ultimo = firma;
        var url = 'http://' + d.ip[0] + ':' + d.porta;
        var qr = el('div', { class: 'qr' });
        try { var q = qrcode(0, 'M'); q.addData(url + '/?pin=' + d.pin); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch (e) {}
        var qrApk = el('div', { class: 'qr', style: 'width:120px;height:120px;flex:none' });
        try { var q2 = qrcode(0, 'L'); q2.addData(LINK_APK); q2.make(); qrApk.innerHTML = q2.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); } catch (e) {}
        var avvio = el('input', { type: 'checkbox' }); avvio.checked = d.avvio;
        avvio.addEventListener('change', function () {
          richiesta('POST', '/api/avvio', { attivo: avvio.checked }).then(function (r) { toast(r.avvio ? 'Partirà da solo all\'accensione del PC' : 'Avvio automatico tolto'); ultimo = ''; aggiorna(); });
        });
        box.innerHTML = '';
        [
          el('h2', { text: '📡 Collega il telefono' }),
          el('div', { class: 'piccolo', text: 'Inquadra con la fotocamera del telefono (stesso Wi-Fi):' }),
          qr,
          el('div', { class: 'piccolo', text: 'oppure apri nel browser del telefono:' }),
          el('div', { class: 'grande', text: url.replace('http://', '') }),
          d.ip.length > 1 ? el('div', { class: 'piccolo', text: 'Altri indirizzi: ' + d.ip.slice(1).join(', ') }) : null,
          el('h3', { text: 'PIN' }),
          el('div', { class: 'grande pin', text: d.pin }),
          el('div', { class: 'riga' }, [
            el('span', { class: 'piccolo', text: d.telefoni + (d.telefoni === 1 ? ' telefono collegato' : ' telefoni collegati') }),
            el('button', { class: 'sec', text: 'Nuovo PIN', style: 'padding:8px 12px', onclick: function () {
              conferma('Cambiare PIN? I telefoni collegati dovranno rimetterlo.', 'Cambia', function () { richiesta('POST', '/api/nuovo-pin', {}).then(function () { ultimo = ''; aggiorna(); }); });
            } })
          ]),
          el('h3', { text: 'App Android' }),
          el('div', { class: 'riga', style: 'align-items:flex-start' }, [qrApk, el('div', { class: 'piccolo', text: 'Inquadra per scaricare MassiDeck.apk, oppure usa direttamente il browser del telefono (va bene anche su iPhone).' })]),
          el('h3', { text: 'Questo PC' }),
          d.windows ? el('label', { class: 'interr' }, [el('span', { text: 'Avvia con Windows' }), avvio]) : null,
          el('div', { class: 'piccolo', text: 'Puoi chiudere questa pagina: MassiDeck resta acceso. Per riaprirla avvia di nuovo MassiDeck.exe.' }),
          el('h3', { text: 'Ultime azioni' }),
          el('div', { class: 'registro', text: reg }),
          el('div', { class: 'azioni' }, [el('button', { class: 'peri', text: '⏻ Spegni MassiDeck', style: 'flex:1', onclick: function () {
            conferma('Spegnere MassiDeck? Il telefono non comanderà più il PC finché non lo riavvii.', 'Spegni', function () {
              richiesta('POST', '/api/chiudi', {}).then(function () { document.body.innerHTML = '<p style="padding:40px;font-size:18px">MassiDeck è spento. Puoi chiudere questa pagina.</p>'; });
            });
          } })])
        ].forEach(function (x) { if (x) box.appendChild(x); });
      }).catch(function () {});
    }
    aggiorna();
    setInterval(aggiorna, 3000);
  }

  // ------------------------------------------------------------ avvio
  function avvia() {
    $('#b-modifica').addEventListener('click', function () { attivaModifica(!modifica); });
    $('#b-impost').addEventListener('click', impostazioni);
    $('#velo').addEventListener('click', chiudiFoglio);
    var bs = $('#b-schermo');
    var plug = APP && window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins : null;
    if (plug && plug.StatusBar) {                     // app: nasconde/mostra la barra di Android
      var nascosta = !!st.barraNascosta;
      if (nascosta) plug.StatusBar.hide().catch(function () {});
      bs.addEventListener('click', function () {
        nascosta = !nascosta; st.barraNascosta = nascosta; salvaSt();
        (nascosta ? plug.StatusBar.hide() : plug.StatusBar.show()).catch(function () {});
        setTimeout(disegna, 300);
      });
    } else if (APP || !document.documentElement.requestFullscreen) bs.hidden = true;
    else bs.addEventListener('click', function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(function () {});
    });
    $('#b-collega').addEventListener('click', function () { collega($('#in-pin').value.trim()); });
    $('#in-pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') collega($('#in-pin').value.trim()); });
    $('#b-cerca').addEventListener('click', cercaPC);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && foglioAperto) chiudiFoglio(); });
    var tRid;
    window.addEventListener('resize', function () { clearTimeout(tRid); tRid = setTimeout(disegna, 120); });
    document.addEventListener('contextmenu', function (e) { if (!/INPUT|TEXTAREA/.test(e.target.tagName)) e.preventDefault(); });

    if (cfg) disegna();               // mostra subito l'ultima copia salvata
    impostaCollegato(false);
    schermoAcceso();

    if (SUL_PC) {
      document.body.classList.add('sul-pc');
      pannelloPC();
      caricaConfig().catch(function () {});
    } else {
      var m = location.search.match(/[?&]pin=(\d{4})/);
      if (m && !APP) {
        history.replaceState(null, '', location.pathname);
        $('#in-pin').value = m[1];
        chiediPin();
        collega(m[1]);
      } else if (!st.token || (APP && !st.base)) chiediPin();
      else caricaConfig().catch(function () {});
    }
    setInterval(controlla, 4000);
  }

  // tasto Indietro di Android: chiude le finestre, poi esce dalla modifica, poi riduce l'app
  if (APP && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('backButton', function () {
      if (foglioAperto) chiudiFoglio();
      else if (modifica) attivaModifica(false);
      else window.Capacitor.Plugins.App.minimizeApp();
    });
  }

  avvia();
  window.MassiDeck = { stato: function () { return { cfg: cfg, st: st, base: base, collegato: collegato }; } };
})();
