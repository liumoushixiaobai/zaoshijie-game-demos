import { ClassroomRenderer, adjacentSeat, actionForKey } from './classroom.mjs';
import { api, examHost } from './exam-api.mjs';

const app = document.querySelector('#exam-app');
const parameters = new URLSearchParams(location.search);
let identity = parameters.has('exam') ? { id: parameters.get('exam'), token: parameters.get('token') || '' } : null;
let room = null;
let pollTimer;
let requestBusy = false;
let actionQueue = Promise.resolve();
let mutationVersion = 0;
let stopped = false;
let paperOpen = false;
let contextMode = '';
let contextSnapshot = '';
let gameRenderer = null;
let messageDraft = '';
let recipientDraft = '';
let questionDraft = 'q2';
let lastSnapshot = '';

let networkError = '';
let materials = null;
let resultStudent = '';
let toastTimer;

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const phaseNames = { lobby: '候场中', review: '考前复习', exam: '正在考试', results: '成绩揭晓' };
const actionNames = { lean: '探头看邻桌', peek: '偷看抽屉资料', share: '传递纸条', ask: '向同学借答案' };

function toast(message) {
    const target = document.querySelector('#exam-toast');
    target.textContent = message;
    target.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => target.classList.remove('visible'), 4000);
}

function roomPath() {
    return `/api/exam/rooms/${encodeURIComponent(identity.id)}`;
}

function seatLink(token) {
    return `${new URL('exam.html', location.href).href}?exam=${encodeURIComponent(identity.id)}&token=${encodeURIComponent(token)}`;
}

function adopt(next) {
    const comparable = { ...next };
    delete comparable.remaining;
    delete comparable.patrol_remaining;
    delete comparable.move_remaining;
    delete comparable.observing;
    if (comparable.activity) {
        comparable.activity = { ...comparable.activity };
        delete comparable.activity.remaining;
    }
    const snapshot = JSON.stringify(comparable);
    const justCaught = (next.caught || 0) > (room?.caught || 0);
    room = next;
    if (justCaught) {
        toast('被监考抓到了！资料已没收，仍可继续答题。');
    }
    networkError = '';
    if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        if (!materials) {
            render();
        }
    } else {
        updateLiveIndicators();
        document.querySelector('#connection-status')?.classList.remove('offline');
        const banner = document.querySelector('#network-error');
        if (banner) {
            banner.hidden = true;
        }
    }
}

async function poll() {
    if (!identity || stopped) {
        return;
    }
    if (!requestBusy) {
        try {
            const version = mutationVersion;
            const next = await api(`${roomPath()}?token=${encodeURIComponent(identity.token)}`);
            if (!requestBusy && version === mutationVersion) {
                adopt(next);
            }
        } catch (error) {
            networkError = `${error.message} 正在重试，已提交的答案保留在当前考场中。`;
            const banner = document.querySelector('#network-error');
            if (banner) {
                banner.textContent = networkError;
                banner.hidden = false;
            }
            document.querySelector('#connection-status')?.classList.add('offline');
        }
    }
    if (room?.phase !== 'results') {
        pollTimer = setTimeout(poll, 500);
    }
}

async function act(action, payload = {}) {
    actionQueue = actionQueue.then(async () => {
        requestBusy = true;
        mutationVersion += 1;
        try {
            adopt(await api(roomPath(), { token: identity.token, action, ...payload }));
        } catch (error) {
            toast(error.message);
        } finally {
            requestBusy = false;
        }
    });
    return actionQueue;
}

function shell(content) {
    const isExam = room?.phase === 'exam';
    return `<header class="site-header"><a class="brand" href="exam.html"><span class="brand-seal">考</span><span>逢考必过<small>THE MEMORY EXAM</small></span></a><nav aria-label="主导航"><a href="exam.html" ${!room ? 'aria-current="page"' : ''}>考场大厅</a><a href="${examHost.memoryLink}">时间记忆 ↗</a>${examHost.showRelay ? '<a href="relay.html">梗图工具 ↗</a>' : ''}<button class="quiet" data-action="rules">玩法说明</button></nav><span class="local-label" id="connection-status"><i></i>${examHost.label}</span></header>
        <main id="main"><div id="network-error" class="network-error" role="status" ${networkError ? '' : 'hidden'}>${esc(networkError)}</div>${content}</main>
        <footer class="site-footer"><span>造世界 / 怀旧娱乐考场</span><span>${isExam ? '偷偷查资料，别被监考看见。' : '你的记忆，值得重新考一次。'}</span><span>PLAYTEST 02</span></footer>
        <dialog id="exam-dialog" aria-labelledby="dialog-title"></dialog>`;
}

function render() {
    if (document.querySelector('#exam-dialog')?.open) {
        return;
    }
    const focused = document.activeElement;
    const focusId = focused?.id;
    const selection = focused instanceof HTMLInputElement && focused.type === 'text' ? [focused.selectionStart, focused.selectionEnd] : null;
    if (room?.phase === 'exam' && document.querySelector('#classroom-canvas') && gameRenderer && !materials) {
        updateGameUI();
        restoreFocus(focusId, selection);
        return;
    }
    gameRenderer?.destroy();
    gameRenderer = null;
    if (room?.phase !== 'exam') {
        paperOpen = false;
        contextMode = '';
    }
    document.body.classList.toggle('in-2d-exam', room?.phase === 'exam' && !materials);
    if (materials) {
        app.innerHTML = shell(materialsHtml());
        return;
    }
    app.innerHTML = shell(room ? roomHtml() : landingHtml());
    if (room?.phase === 'exam') {
        startClassroom();
    }
    document.querySelector('#exam-dialog').addEventListener('close', render, { once: true });
    restoreFocus(focusId, selection);
}

function restoreFocus(focusId, selection) {
    if (focusId) {
        const restored = document.getElementById(focusId);
        if (restored) {
            restored.focus({ preventScroll: true });
            if (selection && restored instanceof HTMLInputElement && restored.type === 'text') {
                restored.setSelectionRange(...selection);
            }
        }
    }
}

function landingHtml() {
    return `<div class="hero"><div class="hero-copy"><div class="eyebrow"><span></span>怀旧娱乐考场 · 玩法验证版</div><h1>这场考试，<br>考的是<span>共同记忆。</span></h1><p>先复习，再回到那张熟悉的课桌。<br>有些答案你记得，有些……同桌可能记得。</p><div class="hero-tags"><span>梗图认亲</span><span>抽屉藏资料</span><span>玩家当监考</span></div><div class="hero-actions"><button class="button rust" data-action="solo">坐下，先玩一场 →</button><button class="quiet" data-action="configure">我要当监考 ↗</button></div></div>
        <div class="hero-paper" aria-label="试玩试卷预览"><div class="paper-pin"></div><div class="paper-small">全国统一 · 网民记忆摸底测试</div><h2>那年上网的你<br>还记得多少？</h2><div class="paper-rule"></div><div class="sample-question"><span>03 / 经典表情包</span><p>这张图，出自哪部电视剧？</p><img src="assets/memes/077.gif" alt="葛优躺，试卷示例"><div class="sample-options"><span>A. 家有儿女</span><span>B. 我爱我家</span><span>C. 武林外传</span><span>D. 编辑部的故事</span></div></div><div class="paper-stamp">允许回忆<br>小心监考</div><small class="paper-bottom">姓名：__________　座号：__________</small></div></div>
        <section class="entry-section"><div class="section-caption"><span>01 / CHOOSE YOUR SEAT</span><h2>先坐下来，试一场。</h2></div><div class="entry-grid"><article class="entry-card primary-entry"><span class="entry-number">01</span><div class="entry-title"><h3>我先当学生</h3><span class="tag">一个人就能玩</span></div><p>自动监考轮流巡视。查自己的资料，向模拟同学借答案，抓紧收起抽屉。</p><div class="entry-meta">1 名真人 ＋ 3 名模拟同学 · 8 道题</div><button class="button rust wide" data-action="solo">领取试卷，开始试玩 <span>↗</span></button></article>
        <article class="entry-card"><span class="entry-number">02</span><div class="entry-title"><h3>组一场真人考试</h3><span class="tag green">学生 × 监考</span></div><p>你当监考，邀请 2—6 位学生。每个人有自己的题目页面和私密复习资料。</p><div class="entry-meta">同一电脑开多个标签页试玩 · 真人传纸条</div><button class="button outline wide" data-action="configure">设置考场，邀请同学 <span>↗</span></button></article></div></section>
        <section class="how-strip"><div><b>01</b><h3>各自复习</h3><p>大纲相同，资料不同。</p></div><span>→</span><div><b>02</b><h3>寻找答案</h3><p>查抽屉，传纸条，互相掩护。</p></div><span>→</span><div><b>03</b><h3>别被发现</h3><p>抓到没收资料，继续答题。</p></div><span>→</span><div><b>04</b><h3>全班看分</h3><p>比个人成绩，也看全班默契。</p></div></section><p class="local-footnote">${examHost.note}</p>`;
}

function roomHeading() {
    const student = room.students.find(item => item.id === room.self_id);
    return `<div class="room-heading"><div><div class="eyebrow">考场 ${esc(room.id)} / ${room.mode === 'solo' ? '单人体验 · 自动监考' : '真人同场'}</div><h1>${room.role === 'teacher' ? '监考席' : `${esc(student.name)}的课桌`}<span class="phase-tag">${phaseNames[room.phase]}</span></h1></div><div class="room-tools">${room.remaining ? `<div class="timer ${room.remaining <= 20 ? 'urgent' : ''}"><small>${room.phase === 'review' ? '距离开考' : '距离收卷'}</small><b>${clock(room.remaining)}</b></div>` : ''}${room.role === 'teacher' || room.mode === 'solo' ? '<button class="button small outline" data-action="materials">线下材料 ↗</button>' : ''}<button class="quiet" data-action="copy-link">复制本席链接</button></div></div>`;
}

function roomHtml() {
    if (room.phase === 'results') {
        return roomHeading() + resultsHtml();
    }
    if (room.phase === 'lobby') {
        return roomHeading() + lobbyHtml();
    }
    if (room.phase === 'review') {
        return roomHeading() + reviewHtml();
    }
    return roomHeading() + gameHtml();
}

function outlineHtml() {
    return `<section class="panel syllabus"><div class="panel-title"><span class="eyebrow">EXAM SYLLABUS</span><h2>这次都考些什么？</h2></div><div class="syllabus-list"><div><b>01</b><span>QQ 空间记忆<small>农场、等级、那些上线的理由</small></span></div><div><b>02</b><span>经典表情包<small>葛优躺、雨女无瓜</small></span></div><div><b>03</b><span>那几年上网<small>网课、钉钉、不讲武德</small></span></div><div><b>04</b><span>视频时代<small>饮茶先、一键三连</small></span></div><p class="muted">8 道单选题，每题 10 分，满分 80 分。全班平均 50 分算共同过关。</p></section>`;
}

function invitesHtml() {
    return `<section class="panel"><div class="panel-title"><h2>把座位链接发给同学</h2><p>每个链接对应一位学生；请分别打开。监考链接留给自己。</p></div><div class="invite-list">${room.invites.map(invite => { const student = room.students.find(item => item.id === invite.student_id); return `<div><span class="seat-number">${esc(invite.student_id.slice(1))}</span><strong>${esc(invite.name)}</strong><span class="connection-tag">${student.joined ? '已入场' : '待入场'}</span><button class="quiet" data-action="copy-seat" data-token="${esc(invite.token)}">复制</button><a class="button small outline" href="${esc(seatLink(invite.token))}" target="_blank" rel="noopener">打开座位 ↗</a></div>`; }).join('')}</div><p class="muted">当前仅支持本机多标签页。链接中含入场身份，只分享对应学生的链接。</p></section>`;
}

function lobbyHtml() {
    const controls = room.role === 'teacher' || room.mode === 'solo';
    return `<div class="room-layout"><div>${room.role === 'teacher' ? invitesHtml() : `<section class="panel welcome-panel"><span class="big-seat">${esc(room.self_id.slice(1))}</span><h2>你的座位，已经留好了。</h2><p>${room.mode === 'solo' ? '同学们已经就座。先看大纲，再领取自己的复习资料。' : '等待监考发放资料。每个人拿到的记忆碎片都不同。'}</p></section>`}${controls ? '<button class="button rust start-button" data-action="review">发资料，进入考前复习 →</button>' : '<div class="waiting-note">等待监考开始复习，本页会自动更新。</div>'}</div>${outlineHtml()}</div>`;
}

function reviewHtml() {
    const controls = room.role === 'teacher' || room.mode === 'solo';
    return `<div class="review-banner"><span>开考前，尽管看。</span><p>可以查手机、搜索大纲、和同学讨论。计时结束后，资料进入抽屉。</p>${controls ? '<button class="button dark small" data-action="start">复习好了，直接开考 →</button>' : ''}</div><div class="room-layout"><div>${room.role === 'teacher' ? invitesHtml() : `<section class="panel"><div class="panel-title"><span class="eyebrow">YOUR MEMORY NOTES</span><h2>只分到你手里的记忆碎片</h2><p>记住它们，你可能也是别人的救命同桌。</p></div><div class="study-notes">${room.notes.map(note => `<article><span>${esc(note.title)}</span><p>${esc(note.text)}</p></article>`).join('')}</div></section>`}</div>${outlineHtml()}</div>`;
}

function questionsHtml(readonly = false, answers = room.answers) {
    return `<section class="exam-paper"><div class="exam-paper-header"><small>全国统一 · 网民记忆摸底测试 / A 卷</small><h2>那些年，我们一起上过的网</h2><div><span>共 8 题 · 满分 80 分</span><span>${readonly ? '已交卷' : `已作答 ${Object.keys(answers || {}).length} / 8`}</span></div></div><div class="exam-questions">${room.questions.map((question, index) => `<fieldset class="question" id="question-${question.id}" ${readonly ? 'disabled' : ''}><legend><span class="question-number">${String(index + 1).padStart(2, '0')}</span><span><small>${esc(question.section)} / 10 分</small>${esc(question.prompt)}</span></legend>${question.image ? `<img class="question-image" src="${esc(question.image)}" alt="第 ${index + 1} 题的梗图" loading="lazy">` : ''}<div class="answer-options">${question.options.map((option, choice) => `<label class="answer-option ${answers?.[question.id] === choice ? 'selected' : ''}"><input type="radio" id="answer-${question.id}-${choice}" name="${question.id}" value="${choice}" ${answers?.[question.id] === choice ? 'checked' : ''} data-question="${question.id}"><span class="option-letter">${String.fromCharCode(65 + choice)}</span><span>${esc(option)}</span></label>`).join('')}</div></fieldset>`).join('')}</div></section>`;
}

function gameHtml() {
    const teacher = room.role === 'teacher';
    return `<section class="game-stage" aria-label="俯视 2D 考场"><canvas id="classroom-canvas" role="img" aria-label="俯视教室：课桌、学生和正在巡视的监考"></canvas><div id="seat-hotspots" class="seat-hotspots"></div><div class="scene-status" id="scene-status" role="status"></div><div class="scene-corner"><span>2D / 俯视考场</span><span id="scene-progress"></span></div><div id="game-context" class="game-context" aria-live="polite"></div></section>
        <div class="game-controls" aria-label="教室操作">${teacher ? `<span class="control-hint">点击课桌，走过去观察</span><button class="game-key catch-key" data-action="catch" id="game-catch" disabled><kbd>抓</kbd><span>抓现行</span></button><button class="game-key" data-action="game-events"><kbd>录</kbd><span>抓人记录</span></button><button class="game-key" data-action="finish-dialog"><kbd>卷</kbd><span>收卷结算</span></button>` : `<button class="game-key primary-key" data-action="game-paper"><kbd>E</kbd><span>展开试卷</span></button><button class="game-key" data-action="game-left"><kbd>A</kbd><span>向左探头</span></button><button class="game-key" data-action="game-right"><kbd>D</kbd><span>向右探头</span></button><button class="game-key" data-action="game-drawer"><kbd>Q</kbd><span>翻抽屉</span></button><button class="game-key" data-action="game-message"><kbd>F</kbd><span>递 / 借纸条</span></button><button class="game-key" data-action="game-inbox"><kbd>I</kbd><span>收到的纸条</span></button><button class="game-key hide-key" data-action="game-hide"><kbd>空格</kbd><span>收手，装写字</span></button>`}</div><div id="exam-overlay" class="exam-overlay" hidden aria-label="全屏试卷"></div>`;
}

function startClassroom() {
    const canvas = document.querySelector('#classroom-canvas');
    gameRenderer = new ClassroomRenderer(canvas, {
        onLayout(layout) {
            const hotspots = document.querySelector('#seat-hotspots');
            if (!hotspots) {
                return;
            }
            hotspots.replaceChildren();
            layout.seats.forEach((seat, index) => {
                const student = room.students[index];
                const button = document.createElement('button');
                button.className = 'seat-hotspot';
                button.dataset.action = 'seat';
                button.dataset.index = String(index);
                button.setAttribute('aria-label', `${room.role === 'teacher' ? '观察' : student.id === room.self_id ? '查看自己的试卷' : '探头看'}：${student.name}`);
                button.style.left = `${seat.x - seat.width / 2 - 7}px`;
                button.style.top = `${seat.y - 37}px`;
                button.style.width = `${seat.width + 14}px`;
                button.style.height = '120px';
                hotspots.append(button);
            });
        },
    });
    contextSnapshot = '';
    gameRenderer.setRoom(room);
    updateGameUI();
}

function updateLiveIndicators() {
    const timer = document.querySelector('.timer');
    if (timer) {
        timer.querySelector('b').textContent = clock(room.remaining);
        timer.classList.toggle('urgent', room.remaining <= 20);
    }
    if (document.querySelector('#classroom-canvas')) {
        updateGameUI();
    }
}

function updateGameUI() {
    if (!document.querySelector('#classroom-canvas')) {
        return;
    }
    gameRenderer?.setRoom(room);
    const status = document.querySelector('#scene-status');
    const watched = room.observing === room.self_id;
    let description = '';
    if (room.role === 'teacher') {
        if (room.move_remaining) {
            description = '正在走向课桌……到达后才能观察';
        } else if (room.observed?.action) {
            description = `看见 ${room.observed.name} 正在${actionNames[room.observed.action]}！`;
        } else {
            description = room.observed ? `正在观察 ${room.observed.name}，暂未发现小动作` : '点击一张课桌，走过去观察';
        }
    } else if (room.submitted) {
        description = '你已交卷，等全班收卷后一起看成绩。';
    } else if (watched) {
        description = '老师在看你！空格立刻收手。';
    } else if (room.activity) {
        description = `${actionNames[room.activity.kind]}中 · 空格随时收手`;
    } else {
        description = '老师在看别处，找准时机做点小动作。';
    }
    status.textContent = description;
    status.classList.toggle('danger', watched || Boolean(room.observed?.action));
    document.querySelector('#scene-progress').textContent = room.role === 'teacher' ? `已抓 ${room.catches} 次 / 挑战 3 次` : `已答 ${Object.keys(room.answers).length} / 8 · 被抓 ${room.caught} 次`;
    const catchButton = document.querySelector('#game-catch');
    if (catchButton) {
        catchButton.disabled = !room.observed?.action;
        catchButton.dataset.student = room.observed?.id || '';
    }
    for (const action of ['game-drawer', 'game-left', 'game-right', 'game-message']) {
        const button = document.querySelector(`[data-action="${action}"]`);
        if (button) {
            button.disabled = room.submitted;
        }
    }
    updateContext();
    if (paperOpen) {
        updatePaper();
    }
}

function contextHtml() {
    if (contextMode === 'message') {
        return `<div class="context-header"><strong>桌下的纸条</strong><button class="quiet" data-action="game-hide" aria-label="收起纸条">×</button></div>${room.mode === 'solo' ? `<label class="field-label" for="ask-question">向模拟同学借哪一题？</label><div class="inline-form"><select id="ask-question">${room.questions.map((question, index) => `<option value="${question.id}" ${questionDraft === question.id ? 'selected' : ''}>第 ${index + 1} 题</option>`).join('')}</select><button class="button small dark" data-action="ask">悄悄借 · 4 秒</button></div>` : `<label class="field-label" for="recipient">递给谁？</label><select id="recipient"><option value="">选一位同学</option>${room.students.filter(student => student.id !== room.self_id && !student.submitted).map(student => `<option value="${student.id}" ${recipientDraft === student.id ? 'selected' : ''}>${esc(student.name)}</option>`).join('')}</select><label class="field-label" for="message">纸条内容</label><input id="message" type="text" maxlength="120" value="${esc(messageDraft)}" placeholder="第 2 题选什么？"><button class="button small dark message-send" data-action="share">桌下传过去 · 4 秒</button>`}`;
    }
    if (contextMode === 'drawer') {
        return `<div class="context-header"><strong>抽屉里的资料</strong><button class="quiet" data-action="game-hide" aria-label="关上抽屉">×</button></div><p class="tiny-note">选择一张，角色会翻开抽屉。2 秒后看清内容。</p>${room.drawer.map(note => `<button class="drawer-choice" data-action="peek" data-note="${note.id}">${esc(note.title)} <span>偷看 →</span></button>`).join('') || '<p class="muted">资料已经被没收了。</p>'}`;
    }
    if (contextMode === 'inbox') {
        return `<div class="context-header"><strong>收到的纸条</strong><button class="quiet" data-action="game-hide" aria-label="收起纸条">×</button></div>${room.inbox.length ? room.inbox.map(item => `<article class="scene-note"><small>${esc(item.from)} 悄悄说</small><p>${esc(item.message)}</p></article>`).join('') : '<p class="muted">还没有纸条。可以先向同学借一题。</p>'}`;
    }
    if (contextMode === 'events') {
        return `<div class="context-header"><strong>监考记录</strong><button class="quiet" data-action="game-hide" aria-label="收起记录">×</button></div>${eventsHtml()}`;
    }
    if (!room.activity) {
        return '';
    }
    const activity = room.activity;
    let content = '<p>正在移动，小动作会暴露自己……</p>';
    if (activity.kind === 'peek') {
        content = activity.note ? `<p class="memory-text">${esc(activity.note.text)}</p>` : '<p>抽屉刚拉开，还没看清……</p>';
    } else if (activity.kind === 'lean') {
        if (activity.neighbor) {
            content = `<p>${esc(activity.neighbor.name)}的卷面：</p><p class="memory-text">${room.questions.map((question, index) => { const choice = activity.neighbor.answers[question.id]; return `${index + 1}：${choice === undefined ? '空' : String.fromCharCode(65 + choice)}`; }).join('　')}</p>`;
        } else {
            content = '<p>正在悄悄探过去，2 秒后能看清邻桌卷面……</p>';
        }
    } else {
        content = '<p>纸条还在路上，4 秒后送达。现在被抓就送不到了。</p>';
    }
    return `<div class="context-header"><strong>${actionNames[activity.kind]}</strong><span class="activity-timer">${activity.remaining}s</span></div>${content}<button class="button dark small" data-action="game-hide">空格 · 收手装写字</button>`;
}

function updateContext() {
    const element = document.querySelector('#game-context');
    const key = JSON.stringify({ mode: contextMode, activity: room.activity, inbox: room.inbox, drawer: room.drawer, events: contextMode === 'events' ? room.events : [] });
    if (key === contextSnapshot) {
        return;
    }
    contextSnapshot = key;
    const focusId = document.activeElement?.id;
    const selection = document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'text' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    element.innerHTML = contextHtml();
    element.hidden = !element.innerHTML;
    restoreFocus(focusId, selection);
}

function updatePaper() {
    const overlay = document.querySelector('#exam-overlay');
    const time = overlay.querySelector('.paper-time');
    if (time) {
        time.textContent = clock(room.remaining);
    }
    for (const input of overlay.querySelectorAll('[data-question]')) {
        const selected = room.answers[input.dataset.question] === Number(input.value);
        input.checked = selected;
        input.closest('label').classList.toggle('selected', selected);
    }
    for (const fieldset of overlay.querySelectorAll('.question')) {
        fieldset.disabled = room.submitted;
    }
    const progress = overlay.querySelector('.exam-paper-header > div > span:last-child');
    if (progress) {
        progress.textContent = `已答 ${Object.keys(room.answers).length} / 8`;
    }
}

async function gameAction(action) {
    if (room?.phase !== 'exam') {
        return;
    }
    if (action === 'paper') {
        if (room.role === 'teacher') {
            toast('监考请点课桌巡视，答案在收卷后揭晓。');
            return;
        }
        paperOpen = !paperOpen;
        const overlay = document.querySelector('#exam-overlay');
        overlay.hidden = !paperOpen;
        if (paperOpen) {
            if (room.activity) {
                await act('close');
            }
            contextMode = '';
            overlay.innerHTML = `<header class="paper-overlay-bar"><span>正在查看试卷 · 考场继续计时</span><b class="paper-time">${clock(room.remaining)}</b><button class="button dark" data-action="game-paper">Esc · 收起试卷</button></header><div class="full-paper-inner">${questionsHtml(room.submitted)}${room.submitted ? '<p>已经交卷，等待全班收卷。</p>' : '<div class="submit-strip"><span>点选答案自动保存。收起卷子，回到 2D 教室。</span><button class="button rust" data-action="submit-dialog">交卷，看成绩 →</button></div>'}</div>`;
            overlay.scrollTop = 0;
            overlay.querySelector('[data-action="game-paper"]').focus();
            updatePaper();
        } else {
            overlay.innerHTML = '';
            document.querySelector('[data-action="game-paper"]').focus();
        }
        return;
    }
    if (action === 'hide') {
        contextMode = '';
        if (room.activity) {
            await act('close');
        }
        updateGameUI();
        return;
    }
    if (room.role === 'teacher') {
        return;
    }
    if (action === 'left' || action === 'right') {
        contextMode = '';
        await act('lean', { direction: action });
    } else if (action === 'peek') {
        contextMode = '';
        if (room.drawer.length) {
            await act('peek', { note_id: room.drawer[0].id });
        } else {
            toast('抽屉空了。');
        }
    } else if (action === 'message' || action === 'inbox') {
        if (room.activity) {
            toast('先按空格收起当前动作。');
            return;
        }
        contextMode = contextMode === action ? '' : action;
        updateGameUI();
    }
}

async function interactSeat(index) {
    const student = room.students[index];
    if (room.role === 'teacher') {
        if (room.move_remaining) {
            toast('正在走过去，再等一下。');
            return;
        }
        await act('observe', { student_id: student.id });
        return;
    }
    const selfIndex = room.students.findIndex(item => item.id === room.self_id);
    if (index === selfIndex) {
        await gameAction('paper');
        return;
    }
    const direction = index < selfIndex ? 'left' : 'right';
    if (adjacentSeat(selfIndex, direction, room.students.length) !== index) {
        toast('太远了，只能探头看同一排的邻桌。');
        return;
    }
    await gameAction(direction);
}

function eventsHtml() {
    return `<section class="panel"><div class="drawer-title"><h2>抓现行记录</h2><span class="tag">${room.catches} 次</span></div>${room.events.length ? `<ul class="event-list">${room.events.map(event => `<li><b>${esc(event.name)}</b><span>${esc(event.message)} · ${event.confiscated ? '没收一份资料' : '已无资料可没收'}</span></li>`).join('')}</ul>` : '<p class="muted">考场暂时很安静。<br>可以走到不同课桌旁，观察他们的动作。</p>'}</section>`;
}

function resultsHtml() {
    const current = room.results.find(item => item.id === (resultStudent || room.self_id)) || room.results[0];
    const passed = room.average >= 50;
    return `<section class="results-banner"><div><div class="eyebrow">CLASS DISMISSED</div><h2>${passed ? '这一次，全班一起过了。' : '有些记忆，还得同桌帮你找。'}</h2><p>全班平均 ${room.average} / 80 分 · 共同目标 50 分 · 监考抓到 ${room.catches} 次${room.mode === 'solo' ? '（含 3 名模拟同学成绩）' : ''}</p></div><div class="result-seal ${passed ? '' : 'retry-seal'}">${passed ? '集体过关' : '下次再战'}</div></section><div class="results-layout"><section class="panel score-panel"><div class="panel-title"><h2>全班成绩单</h2><p>抓到只没收资料，本卷按答案计分。</p></div><table><thead><tr><th>学生</th><th>得分 / 80</th><th>被抓</th></tr></thead><tbody>${[...room.results].sort((first, second) => second.score - first.score).map(student => `<tr ${student.id === room.self_id ? 'class="my-result"' : ''}><td>${esc(student.name)}${student.bot ? '<small>模拟</small>' : ''}</td><td><strong>${student.score}</strong></td><td>${student.caught} 次</td></tr>`).join('')}</tbody></table><div class="result-buttons"><button class="button outline" data-action="report">下载复盘</button>${room.role === 'teacher' || room.mode === 'solo' ? '<button class="button outline" data-action="materials">打印线下材料</button>' : ''}<a href="exam.html" class="button rust">再来一场 ↗</a></div></section><section class="panel answer-review"><div class="panel-title"><h2>那些熟悉的答案</h2><label class="field-label" for="result-student">查看谁的答卷</label><select id="result-student">${room.results.map(student => `<option value="${student.id}" ${student.id === current.id ? 'selected' : ''}>${esc(student.name)}</option>`).join('')}</select></div>${room.questions.map((question, index) => { const key = room.answer_key.find(item => item.id === question.id); const chosen = current.answers[question.id]; return `<article class="review-answer"><span class="review-mark ${chosen === key.answer ? 'correct' : ''}">${chosen === key.answer ? '✓' : '×'}</span><div><h3>${index + 1}. ${esc(question.prompt)}</h3><p>你的答案：${chosen === undefined ? '未作答' : esc(question.options[chosen])}<br>正确答案：<strong>${esc(question.options[key.answer])}</strong></p><small>${esc(key.explanation)}</small></div></article>`; }).join('')}</section></div>`;
}

function materialsHtml() {
    return `<div class="print-toolbar"><div><h1>把这场考试搬到线下。</h1><p>共一份试卷、${materials.students.length} 组私密资料、监考规则与答案。先复印试卷，再按姓名发资料。</p></div><button class="button rust" data-action="print">打印 / 存为 PDF</button><button class="button outline" data-action="back-room">返回考场</button></div><section class="print-sheet"><small>逢考必过 / 线下试玩试卷 · 每名学生一份</small><h2>那些年，我们一起上过的网</h2><p>姓名：________________　座号：________　满分：80 分　考试时长：${room.exam_seconds} 秒</p>${materials.questions.map((question, index) => `<article class="print-question"><h3>${index + 1}. ${esc(question.prompt)}</h3>${question.image ? `<img src="${esc(question.image)}" alt="题目梗图">` : ''}<p>${question.options.map((option, choice) => `${String.fromCharCode(65 + choice)}. ${esc(option)}`).join('　　')}</p></article>`).join('')}</section>${materials.students.map(student => `<section class="print-sheet"><small>私密复习资料 / 只发给对应学生</small><h2>${esc(student.name)}的记忆碎片</h2><p>复习结束放入抽屉。开考后查看、传递资料可能被抓；抓到没收一张，继续考试。</p><div class="print-notes">${student.notes.map(note => `<article><small>${esc(note.title)}</small><p>${esc(note.text)}</p></article>`).join('')}</div></section>`).join('')}<section class="print-sheet answer-key"><small>监考持有 / 请勿混入学生试卷</small><h2>规则与参考答案</h2><p>先复习 ${room.review_seconds} 秒，再考试 ${room.exam_seconds} 秒。可以在复习时查手机、讨论；开考后收起资料。学生尝试偷看或传递信息，监考抓到正在发生的动作即可没收正在用的一张资料；抓错不处罚。不中止学生作答、不扣已得分。每题 10 分，按正确答案计分；全班平均 50 分算共同过关。</p><p>监考仅可巡视当前所在课桌，转移观察目标时留 2 秒移动时间。线下使用真实课桌与纸条，不需要设备识别或演员。</p>${materials.questions.map((question, index) => `<p><b>${index + 1}. ${String.fromCharCode(65 + question.answer)} / ${esc(question.options[question.answer])}</b><br>${esc(question.explanation)}</p>`).join('')}</section>`;
}

function showDialog(title, content) {
    const dialog = document.querySelector('#exam-dialog');
    dialog.innerHTML = `<div class="dialog-body"><div class="dialog-top"><h2 id="dialog-title">${title}</h2><button class="quiet" data-action="close-dialog" aria-label="关闭">×</button></div>${content}</div>`;
    dialog.showModal();
}

function configurationHtml() {
    return `<form id="create-room"><p class="muted">你坐监考席。每名学生使用独立链接，答案与资料各自保密。</p><div class="form-grid"><label>学生人数<select id="student-count" name="count">${[2, 3, 4, 5, 6].map(count => `<option value="${count}" ${count === 4 ? 'selected' : ''}>${count} 人</option>`).join('')}</select></label><label>复习时间<select name="review"><option value="30">30 秒</option><option value="90" selected>90 秒</option><option value="120">2 分钟</option></select></label><label>考试时间<select name="exam"><option value="60">1 分钟 · 快测</option><option value="180">3 分钟</option><option value="300" selected>5 分钟</option></select></label></div><div id="name-fields" class="name-fields">${nameFields(4)}</div><p class="tiny-note">${examHost.note}</p><button class="button rust wide" type="submit">创建考场 →</button></form>`;
}

function nameFields(count, names = []) {
    return Array.from({ length: count }, (_, index) => `<label>第 ${index + 1} 座<input class="student-name" type="text" name="student" maxlength="12" required value="${esc(names[index] || `同学 ${index + 1}`)}"></label>`).join('');
}

async function createRoom(settings) {
    if (requestBusy) {
        return;
    }
    requestBusy = true;
    try {
        identity = await api('/api/exam/rooms', settings);
        document.querySelector('#exam-dialog')?.close();
        history.replaceState(null, '', seatLink(identity.token));
        adopt(await api(`${roomPath()}?token=${encodeURIComponent(identity.token)}`));
        clearTimeout(pollTimer);
        stopped = false;
        poll();
        window.scrollTo({ top: 0 });
    } catch (error) {
        toast(error.message);
    } finally {
        requestBusy = false;
    }
}

async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast('入场链接已复制。');
    } catch {
        showDialog('复制入场链接', `<p class="muted">浏览器未允许自动复制，可以选中下面的链接手动复制。</p><input readonly value="${esc(text)}" aria-label="入场链接">`);
    }
}

function downloadReport() {
    const content = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>怀旧考场复盘</title><style>body{max-width:960px;margin:40px auto;padding:20px;font:16px/1.8 sans-serif;color:#262f29}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #ddd;padding:12px}.results-layout{display:block}.result-buttons,.result-seal,select,label{display:none}.review-answer{margin:20px 0;padding:15px;border:1px solid #ddd}.review-mark{display:none}.eyebrow{font-size:12px}</style><h1>逢考必过 · 本场复盘</h1><p>考场 ${esc(room.id)} / ${new Date().toLocaleString('zh-CN')}</p>${resultsHtml()}</html>`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/html;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `怀旧考场-${room.id}-复盘.html`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

app.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) {
        return;
    }
    event.preventDefault();
    const action = button.dataset.action;
    if (['review', 'start', 'peek', 'close', 'ask', 'share', 'observe', 'catch', 'submit', 'finish', 'lean'].includes(action)) {
        if (action === 'submit' || action === 'finish') {
            document.querySelector('#exam-dialog').close();
        }
        contextMode = '';
        contextSnapshot = '';
        if (action === 'share') {
            await act(action, { recipient_id: recipientDraft, message: messageDraft });
        } else if (action === 'ask') {
            await act(action, { question_id: questionDraft });
        } else {
            await act(action, { note_id: button.dataset.note, student_id: button.dataset.student, direction: button.dataset.direction });
        }
        return;
    }
    switch (action) {
        case 'solo': await createRoom({ mode: 'solo', names: ['我', '小林', '阿圆', '大壮'], review_seconds: 30, exam_seconds: 180 }); break;
        case 'configure': showDialog('组一场真人考试', configurationHtml()); break;
        case 'close-dialog': document.querySelector('#exam-dialog').close(); break;
        case 'game-paper': await gameAction('paper'); break;
        case 'game-peek': await gameAction('peek'); break;
        case 'game-left': await gameAction('left'); break;
        case 'game-right': await gameAction('right'); break;
        case 'game-hide': await gameAction('hide'); break;
        case 'game-message': await gameAction('message'); break;
        case 'game-inbox': await gameAction('inbox'); break;
        case 'game-events': contextMode = contextMode === 'events' ? '' : 'events'; updateGameUI(); break;
        case 'game-drawer': contextMode = contextMode === 'drawer' ? '' : 'drawer'; updateGameUI(); break;
        case 'seat': await interactSeat(Number(button.dataset.index)); break;
        case 'copy-link': await copy(location.href); break;
        case 'copy-seat': await copy(seatLink(button.dataset.token)); break;
        case 'submit-dialog':
            showDialog('准备交卷了吗？', `<p>已答 ${Object.keys(room.answers).length} / 8 题。交卷后不能再改答案，也不能继续传纸条。</p><button class="button rust" data-action="submit">确认交卷 →</button>`);
            break;
        case 'finish-dialog': showDialog('现在收卷？', '<p>所有学生将停止作答，立即结算当前答案。</p><button class="button rust" data-action="finish">确认收卷，公布成绩</button>'); break;
        case 'rules': showDialog('这次考试，怎么玩？', `<ol class="rules-list"><li><b>先复习。</b>每个人只拿到部分资料，开考前可看手机、讨论。</li><li><b>俯视教室。</b>A / D 向左右探头，Q 偷翻抽屉，F 借答案或传纸条，空格立即收手装写字。</li><li><b>展开试卷。</b>E 打开铺满网页的答卷，选择答案后自动保存；Esc / 收起试卷回到教室。开卷会收起正在使用的资料。</li><li><b>看监考。</b>监考一次只看一张桌子，学生能看到他的位置。单人模式每 4 秒换一个座位。</li><li><b>抓现行。</b>偷看 2 秒后可读资料，传纸条要 4 秒。动作中被抓就没收一份资料，纸条作废；已写答案保留。</li><li><b>一起看分。</b>个人满分 80；全班平均 50 分算过关。监考挑战抓到 3 次。</li></ol><p class="muted">单人模式同学与监考由程序模拟；多人模式由真人操作。${examHost.persistence}用于玩法验证，不用于正式考试。</p>`); break;
        case 'materials':
            try {
                materials = await api(`${roomPath()}/materials?token=${encodeURIComponent(identity.token)}`);
                render();
                window.scrollTo({ top: 0 });
            } catch (error) { toast(error.message); }
            break;
        case 'back-room': materials = null; render(); break;
        case 'print': window.print(); break;
        case 'report': downloadReport(); break;
    }
});

app.addEventListener('input', event => {
    if (event.target.id === 'message') {
        messageDraft = event.target.value;
    }
});

app.addEventListener('change', async event => {
    const input = event.target;
    if (input.dataset.question) {
        await act('answer', { question_id: input.dataset.question, choice: Number(input.value) });
    } else if (input.id === 'recipient') {
        recipientDraft = input.value;
    } else if (input.id === 'ask-question') {
        questionDraft = input.value;
    } else if (input.id === 'student-count') {
        const names = [...document.querySelectorAll('.student-name')].map(field => field.value);
        document.querySelector('#name-fields').innerHTML = nameFields(Number(input.value), names);
    } else if (input.id === 'result-student') {
        resultStudent = input.value;
        render();
    }
});

app.addEventListener('submit', async event => {
    if (event.target.id !== 'create-room') {
        return;
    }
    event.preventDefault();
    const form = new FormData(event.target);
    await createRoom({ mode: 'multi', names: form.getAll('student'), review_seconds: Number(form.get('review')), exam_seconds: Number(form.get('exam')) });
});

window.addEventListener('keydown', event => {
    if (event.repeat || room?.phase !== 'exam' || document.querySelector('#exam-dialog')?.open || materials) {
        return;
    }
    const typing = event.target.matches('input[type="text"], textarea, select, [contenteditable="true"]');
    const action = actionForKey(event.key, typing, paperOpen);
    if (action) {
        event.preventDefault();
        gameAction(action);
    }
});

window.addEventListener('pagehide', () => { stopped = true; clearTimeout(pollTimer); gameRenderer?.destroy(); });
window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; gameRenderer = null; render(); poll(); } });

async function boot() {
    render();
    if (identity) {
        try {
            adopt(await api(`${roomPath()}?token=${encodeURIComponent(identity.token)}`));
            poll();
        } catch (error) {
            app.innerHTML = shell(`<section class="panel error-panel"><h1>暂时进不了这个考场。</h1><p>${esc(error.message)}</p><a class="button rust" href="exam.html">回大厅重新开局 →</a></section>`);
        }
    }
}

boot();
