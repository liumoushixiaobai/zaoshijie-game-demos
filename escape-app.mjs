import { EscapeGame, PUZZLES } from './escape-world.mjs';

const canvas = document.querySelector('#map');
const context = canvas.getContext('2d');
const overlay = document.querySelector('#overlay');
const toastElement = document.querySelector('#toast');
const puzzlesById = Object.fromEntries(PUZZLES.map(puzzle => [puzzle.id, puzzle]));
const rooms = PUZZLES.map((puzzle, index) => ({ ...puzzle, x: 24 + index % 3 * 400, y: index < 3 ? 20 : 410, w: 352, h: 265 }));
let game = new EscapeGame();
let activePuzzle = null;
let sequence = [];
let maskAligned = false;
let archiveOrder = [];
let selectedPhoto = null;
let screenType = 'intro';
let toastTimer;
let previousTime = performance.now();

const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const escape = text => String(text).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function notify(message) {
    toastElement.textContent = message;
    toastElement.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastElement.classList.remove('visible'), 3500);
}

function showDialog(html, type) {
    overlay.innerHTML = html;
    screenType = type;
    if (!overlay.open) {
        overlay.showModal();
    }
}

function dialogHeading(kicker, title) {
    return `<header class="dialog-head"><div><p class="eyebrow">${kicker}</p><h2 id="dialog-title">${title}</h2></div><button data-action="close" aria-label="关闭当前窗口，返回地图">回到地图 ↗</button></header>`;
}

function showIntro() {
    showDialog(`<article class="intro"><p class="eyebrow">THE UNFINISHED DRAFT / 2019 — 2020</p><h1 id="dialog-title">那年没拍完的，<br><em>这次一起存下来。</em></h1><p>旧手机里，留着一个叫“等见面再拍”的草稿箱。<br>一半是2019年的暑假，一半是2020年的春天。<br>找回散落的照片，把那段日子重新连起来。</p><p class="intro-detail">20分钟 · 6道谜题 · 两条支线<br>纯合作密室解谜，可独自完成，也可同屏讨论。<br>点击地图物件或下方房间入口。卡住时可领取三级提示。<br>本轮不保存，刷新会重新开始。</p><button class="primary" data-action="start">打开草稿箱 →</button></article>`, 'intro');
}

function refreshHud() {
    document.querySelector('#progress').textContent = `照片 ${game.solved.length} / 6`;
    document.querySelector('#archive-count').textContent = `${game.solved.length} / 6`;
    document.querySelector('#timer').textContent = clock(game.remaining);
    document.querySelector('#pause').disabled = game.phase !== 'playing';
    document.querySelector('#journal').disabled = game.phase !== 'playing';
    document.querySelector('#rooms').innerHTML = rooms.map(room => `<button data-action="room" data-id="${room.id}" class="${game.solved.includes(room.id) ? 'done' : ''}" ${game.phase !== 'playing' ? 'disabled' : ''}>${game.solved.includes(room.id) ? '✓ ' : ''}${room.room}</button>`).join('');
}

function box(x, y, width, height, color, border = '') {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
    if (border) {
        context.strokeStyle = border;
        context.lineWidth = 2;
        context.strokeRect(x, y, width, height);
    }
}

function text(value, x, y, size = 16, color = '#465b46') {
    context.fillStyle = color;
    context.font = `${size}px "PingFang SC",sans-serif`;
    context.textAlign = 'center';
    context.fillText(value, x, y);
}

function drawMap() {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = bounds.width * ratio;
    canvas.height = bounds.height * ratio;
    context.setTransform(canvas.width / 1200, 0, 0, canvas.height / 700, 0, 0);
    box(0, 0, 1200, 700, '#bdc7a8');
    box(0, 293, 1200, 107, '#dad6c0');
    for (let x = 0; x < 1200; x += 40) {
        box(x, 300, 1, 95, '#c5c7b1');
    }
    text('2020 / 在屏幕两端继续见面', 245, 330, 16, '#82917b');
    text('2019 / 等见面再拍', 985, 375, 16, '#82917b');
    for (const room of rooms) {
        const solved = game.solved.includes(room.id);
        box(room.x, room.y, room.w, room.h, solved ? '#dbe2c7' : '#e5ddc1', '#7f8c73');
        box(room.x + 9, room.y + 9, room.w - 18, room.h - 18, room.y > 300 ? '#e1cfac' : '#d5d7ba');
        for (let row = 0; row < 5; row += 1) {
            box(room.x + 12, room.y + 50 + row * 40, room.w - 24, 1, '#c4c5a859');
        }
        const x = room.x;
        const y = room.y;
        if (room.id === 'mic') {
            box(x + 48, y + 56, 160, 62, '#a28c64', '#897955');
            box(x + 89, y + 61, 75, 43, '#6d8474', '#53694e');
            box(x + 96, y + 67, 61, 28, '#c0cfb6');
            box(x + 110, y + 111, 38, 5, '#675f48');
            box(x + 44, y + 171, 34, 42, '#5d7f86');
            box(x + 89, y + 171, 34, 42, '#a66b59');
            box(x + 134, y + 171, 34, 42, '#7c9363');
            box(x + 179, y + 171, 34, 42, '#b39852');
            box(x + 258, y + 73, 52, 143, '#aebb9c', '#8c9a7c');
            box(x + 262, y + 78, 44, 28, '#f2e7c6');
        } else if (room.id === 'homework') {
            box(x + 55, y + 67, 244, 130, '#aa9268', '#8a7954');
            box(x + 116, y + 85, 109, 90, '#f0ead7', '#c5c2a8');
            for (let i = 0; i < 4; i += 1) {
                box(x + 130, y + 100 + i * 15, 78, 2, '#a5b39b');
            }
            box(x + 59, y + 77, 42, 26, '#697e60');
            box(x + 253, y + 95, 7, 67, '#687a58');
            box(x + 237, y + 87, 38, 17, '#7a925d');
        } else if (room.id === 'parcel') {
            for (let i = 0; i < 3; i += 1) {
                box(x + 40 + i * 96, y + 75, 82, 120, '#a68e67', '#7d7455');
                box(x + 47 + i * 96, y + 105, 68, 62, '#ccb98a');
                text(String(301 + i), x + 80 + i * 96, y + 95, 14);
            }
        } else if (room.id === 'rhythm') {
            box(x + 55, y + 67, 138, 93, '#a18c68', '#7c7151');
            box(x + 68, y + 77, 112, 59, '#677e6c');
            text('←  →  ∪  →', x + 125, y + 113, 22, '#eee5b7');
            box(x + 233, y + 65, 77, 142, '#9fb795', '#819a75');
            for (let i = 0; i < 4; i += 1) {
                box(x + 55 + i * 36, y + 186, 30, 37, '#f2e8ce', '#a5a888');
            }
        } else if (room.id === 'outfit') {
            box(x + 55, y + 69, 94, 132, '#b29f7c', '#8d805e');
            box(x + 65, y + 78, 74, 110, '#869d8b');
            box(x + 219, y + 67, 70, 116, '#9d8060', '#7f7359');
            box(x + 235, y + 76, 39, 65, '#e8dfc6');
            box(x + 174, y + 176, 118, 34, '#b5a383', '#897e5d');
        } else {
            box(x + 54, y + 60, 245, 104, '#6d8278', '#7b886d');
            for (let i = 0; i < 6; i += 1) {
                box(x + 83 + i % 3 * 60, y + 75 + Math.floor(i / 3) * 39, 35, 27, [0, 2, 3, 4].includes(i) ? '#e9d580' : '#435e52', '#b5bca0');
            }
            box(x + 100, y + 189, 153, 29, '#b4a17b', '#8d815b');
            box(x + 146, y + 173, 62, 30, '#d2b77a', '#aa8e56');
        }
        box(x + 15, y + 15, room.w - 30, 27, '#f0ebd8');
        text(`${solved ? '✓ ' : ''}${room.room}`, x + room.w / 2, y + 34, 17);
        text(solved ? '照片已找到' : game.isUnlocked(room.id) ? '点击探索' : '可查看现场 · 尚缺线索', x + room.w / 2, y + room.h - 16, 12, '#66785c');
    }
}

function openRoom(id) {
    if (game.phase !== 'playing') {
        return;
    }
    activePuzzle = id;
    sequence = [];
    maskAligned = false;
    renderRoom();
}

function classroomScene() {
    const channelButtons = [['home', '家庭'], ['lesson', '课堂'], ['alert', '提示音']].map(([id, name]) => `<button data-action="channel" data-id="${id}" class="${game.channels[id] ? '' : 'off'}" aria-pressed="${!game.channels[id]}">${name} ${game.channels[id] ? '开启' : '关闭'}</button>`).join('');
    let speech = '课堂声道已关闭。';
    if (game.channels.lesson) {
        speech = game.channels.home ? '家里：吃饭啦——！／老师：第……靠……本子……／家里：听见没有？' : '老师：第二排靠窗那位，把你的本子借给隔壁同学。';
    }
    return `<div class="channel-list">${channelButtons}</div><div class="teacher" role="status">${speech}</div><small>讲台在上方；左侧是窗户。每一行是一排。</small><div class="seats"><span>窗</span><button class="book red" data-action="book" data-id="red">第一排 · 红本</button><button class="book green" data-action="book" data-id="green">第一排 · 绿本</button><span>窗</span><button class="book blue" data-action="book" data-id="blue">第二排 · 蓝本</button><button class="book yellow" data-action="book" data-id="yellow">第二排 · 黄本</button></div><p class="evidence">电脑边的便签：先听清楚，再替老师找本子。三个开关是模拟声道，本试玩不播放真实课堂录音。</p>`;
}

function homeworkScene() {
    const digits = [7, 3, 0, 6, 9, 2, 4, 8, 1, 5, 7, 0];
    return `<p class="note">老师：把取景模板对准四角，从上到下、每行从左到右，读取露出的数字。</p><div class="clue-grid ${maskAligned ? 'masked' : ''}">${digits.map((digit, i) => `<span class="${[1, 7, 8].includes(i) ? 'revealed' : ''}">${digit}</span>`).join('')}</div><button data-action="mask" style="margin-top:15px" ${game.isUnlocked('homework') ? '' : 'disabled'}>${maskAligned ? '移开模板' : '对齐蓝本里的取景模板'}</button>`;
}

function framesScene() {
    return `<div class="storyboard"><div class="frame coat"><div class="head"></div><div class="shirt"></div><strong>外套完整露脸</strong><small>底片D</small></div><div class="frame black"><p style="padding:14px 0">镜头被<br>完全挡住</p><small>底片B</small></div><div class="frame"><div class="head"></div><div class="shirt"></div><strong>校服完整露脸</strong><small>底片A</small></div><div class="frame coat half"><div class="head"></div><div class="shirt"></div><strong>外套 · 半遮镜头</strong><small>底片C</small></div></div><p class="note">从校服出镜，到外套完整出镜；剪接只能藏在镜头被挡住的时候。</p>`;
}

function puzzleScene(id) {
    if (id === 'mic') {
        return classroomScene();
    }
    if (id === 'homework') {
        return homeworkScene();
    }
    if (id === 'parcel') {
        return `<div class="chat"><p><b>阿圆：</b>纸和水都先给别人，我拿剩下的。</p><p><b>小林：</b>我不要水。</p><p><b>小陈：</b>好，我拿最后剩下的一件。</p></div><p class="note">三个人，每人领一件：胶带、纸张、矿泉水。<br>收件名单：301阿圆 · 302小林 · 303小陈。</p>`;
    }
    if (id === 'rhythm') {
        return `<p class="note">先看一遍，再把四拍接回来。<br>左右以观看画面的你为准，杯子表示暂停。</p><div class="storyboard">${[['←', '左'], ['→', '右'], ['∪', '暂停'], ['→', '右']].map(([symbol, label]) => `<div class="frame"><p style="font-size:35px;margin:5px 0">${symbol}</p><small>${label}</small></div>`).join('')}</div><p class="evidence">2019/07/20 · 暑假拍摄练习<br>我们说好，熟练了再一起拍最后一条。</p>`;
    }
    const windows = [[9, true], [4, false], [2, true], [6, true], [1, true], [7, false]];
    return `<div class="window-board">${windows.map(([digit, lit]) => `<div class="window ${lit ? 'lit' : ''}">${digit}<small>${lit ? '亮窗' : '暗窗'}</small></div>`).join('')}</div><small>上方是二层，下方是一层。</small>${game.isUnlocked(id) ? '<p class="note">草稿箱便签：从下往上，每层从左到右，只读亮着的窗。</p>' : '<p class="evidence">窗台的档案盒需要四位数字。还不知道从哪里开始读。</p>'}`;
}

function controlsFor(id) {
    if (!game.isUnlocked(id)) {
        const required = puzzlesById[puzzlesById[id].requires];
        return `<h3>这里还缺一件线索。</h3><p>可以先观察现场。${required.room}里留下的资料会帮上忙。</p><button data-action="room" data-id="${required.id}">去${required.room} ↗</button>`;
    }
    if (game.solved.includes(id)) {
        return `<div class="reward"><p class="eyebrow">MEMORY FOUND</p><h3>这一张，找回来了。</h3><p>${puzzlesById[id].time}</p><p>新资料：${puzzlesById[id].reward}</p><button class="primary" data-action="journal">打开手记</button></div>`;
    }
    let input;
    if (['homework', 'chorus'].includes(id)) {
        const count = id === 'homework' ? 3 : 4;
        input = `<form id="answer-form"><label for="code">${count}位档案密码</label><input id="code" name="answer" inputmode="numeric" pattern="[0-9]{${count}}" maxlength="${count}" autocomplete="off" required aria-label="${count}位档案密码"><button class="primary" type="submit" style="margin-top:12px;width:100%">打开档案 →</button></form>`;
    } else if (id === 'parcel') {
        input = `<form id="answer-form">${[301, 302, 303].map(unit => `<label style="margin-bottom:12px">${unit}<select name="unit${unit}" aria-label="${unit}的物品"><option value="">选择物品</option><option value="tape">胶带</option><option value="paper">纸张</option><option value="water">矿泉水</option></select></label>`).join('')}<button class="primary" type="submit">确认归属 →</button></form>`;
    } else if (id === 'mic') {
        input = '<p>切换声道，选择老师描述的那一本。</p>';
    } else {
        const choices = id === 'rhythm' ? [['L', '← 左'], ['R', '→ 右'], ['P', '∪ 暂停']] : [['A', '底片A'], ['B', '底片B'], ['C', '底片C'], ['D', '底片D']];
        const label = value => choices.find(([key]) => key === value)?.[1];
        input = `<div class="sequence" aria-label="当前排列">${sequence.length ? sequence.map(value => `<span>${label(value)}</span>`).join('') : '<small>依次选择下方的四张卡</small>'}</div><div class="choice-buttons">${choices.map(([value, title]) => `<button data-action="sequence" data-id="${value}">${title}</button>`).join('')}</div><button data-action="clear-sequence">重新排列</button><button class="primary" data-action="confirm-sequence" ${sequence.length === 4 ? '' : 'disabled'}>确认四格顺序 →</button>`;
    }
    return `<h3>${id === 'parcel' ? '把三件物品分给邻居。' : '试着把线索连起来。'}</h3>${input}<button data-action="hint">需要一点提示 <small>(${game.hints[id] || 0}/3)</small></button><div class="hint" id="hint-text">${game.hints[id] ? puzzlesById[id].hints[game.hints[id] - 1] : ''}</div>`;
}

function renderRoom() {
    const puzzle = puzzlesById[activePuzzle];
    showDialog(`${dialogHeading(`${puzzle.time.startsWith('2019') ? '2019 / SUMMER' : '2020 / SPRING'} · ${puzzle.room}`, puzzle.title)}<div class="dialog-body"><div class="puzzle-grid"><section class="scene" aria-label="现场线索">${puzzleScene(activePuzzle)}</section><section class="controls" aria-label="解谜操作">${controlsFor(activePuzzle)}<div class="feedback" id="feedback" role="status"></div></section></div></div>`, 'puzzle');
}

function solve(answer) {
    const result = game.solve(activePuzzle, answer);
    if (result.ok) {
        renderRoom();
        refreshHud();
        drawMap();
        notify(result.message);
    } else {
        document.querySelector('#feedback').textContent = result.message;
    }
}

function showJournal() {
    const entries = game.solved.map(id => {
        const puzzle = puzzlesById[id];
        let detail = '';
        if (id === 'mic') {
            detail = '取景模板：三行四列，四角对齐。开窗为第一行第二格、第二行第四格、第三行第一格。';
        } else if (id === 'homework') {
            detail = '收件名单：301阿圆、302小林、303小陈。';
        } else if (id === 'rhythm') {
            detail = '四张底片已交到拍同款角：D外套露脸、B全黑、A校服露脸、C外套半遮。';
        } else if (id === 'outfit') {
            detail = '窗户便签：从下往上，每层从左到右，只读亮着的窗。';
        }
        return `<article><p class="eyebrow">${puzzle.time}</p><h3>${puzzle.room}的照片</h3><p>获得：${puzzle.reward}</p><p>${detail}</p></article>`;
    }).join('');
    showDialog(`${dialogHeading('FIELD NOTES / 线索不会消失', '随身手记')}<div class="dialog-body"><p>已找回 ${game.solved.length} / 6 张照片。阅读手记时继续计时，需要休息可返回地图点击暂停。</p><div class="inventory">${entries || '<p>还没找到照片。网课卧室和暑假拍摄角可以先探索。</p>'}</div></div>`, 'journal');
}

function showArchive() {
    if (game.phase !== 'playing') {
        return;
    }
    if (archiveOrder.length !== 6) {
        archiveOrder = Array(6).fill(null);
    }
    const cards = game.solved.filter(id => !archiveOrder.includes(id));
    showDialog(`${dialogHeading('THE PHOTO ALBUM / 记忆汇合', '按拍摄日期，把照片排回来。')}<div class="dialog-body"><p>先选照片，再选上方格子；选中的照片可与已有照片交换。收齐六张才能完成存档。</p><div class="album-slots">${archiveOrder.map((id, i) => `<button class="${id ? 'occupied' : ''}" data-action="slot" data-slot="${i}" aria-label="相册第${i + 1}格${id ? '：' + puzzlesById[id].room : '，空白'}">${id ? `${puzzlesById[id].time}<br>${puzzlesById[id].room}` : `${i + 1} / ＋`}</button>`).join('')}</div><div class="album">${cards.map(id => `<button class="photo ${selectedPhoto === id ? 'chosen' : ''}" data-action="photo" data-id="${id}"><span class="photo-art">${puzzlesById[id].icon}</span><small>${puzzlesById[id].time}</small><b>${puzzlesById[id].room}</b></button>`).join('') || '<p>所有已找到的照片都已放入上方。</p>'}</div><p class="feedback" id="feedback" role="status">${selectedPhoto ? '已选：' + puzzlesById[selectedPhoto].room : '按日期从早到晚排列。'}</p><button class="primary" data-action="confirm-archive">翻读背面，完成存档 →</button><button data-action="reset-archive">重新排列</button></div>`, 'archive');
}

function showEnding() {
    const won = game.phase === 'won';
    showDialog(`<article class="ending"><p class="eyebrow">${won ? 'MEMORY ARCHIVED' : 'TO BE CONTINUED'}</p><h1 id="dialog-title">${won ? '把今天存下来。' : '还有一些记忆，<br>下次一起找。'}</h1><img src="assets/memory-album.svg" alt="书桌、手机、作业和窗边的日常回忆插画"><p>${won ? '不是每条视频都发出去了，<br>但我们一起拍过。' : `这次找回了${game.solved.length}张照片。<br>线索还在原地，可以再回去一次。`}</p><p>2019年夏天 · 2020年春天<br>已找回 ${game.solved.length}/6 张 · 用时 ${clock(1200 - game.remaining)}</p><button class="primary" data-action="restart">重新打开草稿箱 →</button></article>`, 'ending');
    refreshHud();
}

function closeDialog() {
    if (['intro', 'ending', 'paused'].includes(screenType)) {
        return;
    }
    overlay.close();
    activePuzzle = null;
    screenType = '';
}

function pauseGame() {
    if (game.phase !== 'playing') {
        return;
    }
    game.pause();
    showDialog(`<article class="intro"><p class="eyebrow">PAUSED</p><h1 id="dialog-title">记忆等你一会。</h1><p>倒计时已暂停，线索与照片都保留。</p><button class="primary" data-action="resume">回到这段记忆 →</button></article>`, 'paused');
    refreshHud();
}

function handleAction(button) {
    const { action, id } = button.dataset;
    if (action === 'start' || action === 'restart') {
        game = new EscapeGame();
        game.start();
        archiveOrder = Array(6).fill(null);
        selectedPhoto = null;
        activePuzzle = null;
        screenType = '';
        overlay.close();
        previousTime = performance.now();
        refreshHud();
        drawMap();
    } else if (action === 'close') {
        closeDialog();
    } else if (action === 'room') {
        openRoom(id);
    } else if (action === 'channel') {
        game.toggleChannel(id);
        renderRoom();
    } else if (action === 'book') {
        solve(id);
    } else if (action === 'mask') {
        maskAligned = !maskAligned;
        renderRoom();
    } else if (action === 'sequence') {
        if (sequence.length < 4) {
            sequence.push(id);
        }
        renderRoom();
    } else if (action === 'clear-sequence') {
        sequence = [];
        renderRoom();
    } else if (action === 'confirm-sequence') {
        solve(sequence);
    } else if (action === 'hint') {
        const result = game.hint(activePuzzle);
        renderRoom();
        document.querySelector('#hint-text').textContent = result.message;
    } else if (action === 'journal') {
        showJournal();
    } else if (action === 'archive') {
        showArchive();
    } else if (action === 'photo') {
        selectedPhoto = id;
        showArchive();
    } else if (action === 'slot') {
        const slot = Number(button.dataset.slot);
        if (selectedPhoto) {
            const oldSlot = archiveOrder.indexOf(selectedPhoto);
            const displaced = archiveOrder[slot];
            archiveOrder[slot] = selectedPhoto;
            if (oldSlot !== -1 && oldSlot !== slot) {
                archiveOrder[oldSlot] = displaced;
            }
            selectedPhoto = null;
        } else {
            selectedPhoto = archiveOrder[slot];
        }
        showArchive();
    } else if (action === 'reset-archive') {
        archiveOrder = Array(6).fill(null);
        selectedPhoto = null;
        showArchive();
    } else if (action === 'confirm-archive') {
        const result = game.archive(archiveOrder);
        if (result.ok) {
            showEnding();
        } else {
            document.querySelector('#feedback').textContent = result.message;
        }
    } else if (action === 'pause') {
        pauseGame();
    } else if (action === 'resume') {
        game.resume();
        overlay.close();
        screenType = '';
        previousTime = performance.now();
        refreshHud();
    }
}

document.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (button && !button.disabled) {
        handleAction(button);
    }
});

overlay.addEventListener('submit', event => {
    if (event.target.id !== 'answer-form') {
        return;
    }
    event.preventDefault();
    const data = new FormData(event.target);
    const answer = activePuzzle === 'parcel' ? [301, 302, 303].map(unit => data.get(`unit${unit}`)) : data.get('answer');
    solve(answer);
});

overlay.addEventListener('cancel', event => {
    event.preventDefault();
    if (screenType === 'paused') {
        handleAction({ dataset: { action: 'resume' } });
    } else {
        closeDialog();
    }
});

canvas.addEventListener('click', event => {
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * 1200;
    const y = (event.clientY - bounds.top) / bounds.height * 700;
    const room = rooms.find(item => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h);
    if (room) {
        openRoom(room.id);
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.phase === 'playing') {
        pauseGame();
    }
});

setInterval(() => {
    const now = performance.now();
    const elapsed = (now - previousTime) / 1000;
    previousTime = now;
    game.tick(elapsed);
    document.querySelector('#timer').textContent = clock(game.remaining);
    if (game.phase === 'lost' && screenType !== 'ending') {
        showEnding();
    }
}, 200);

new ResizeObserver(drawMap).observe(canvas);
refreshHud();
drawMap();
showIntro();
