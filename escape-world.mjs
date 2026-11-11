const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

export const PUZZLES = [
    { id: 'mic', room: '网课卧室', title: '老师刚才说了什么', time: '2020/03/16 09:00', word: '存', requires: null, reward: '作业取景模板', icon: '◉',
        hints: ['先比较三个声道分别传来什么。', '关掉家庭声道，保留课堂声音，再找老师描述的书。', '保持课堂开启、家庭关闭，选择第二排靠窗的蓝色书。'] },
    { id: 'homework', room: '作业书桌', title: '交不上的作业', time: '2020/03/16 11:30', word: '下', requires: 'mic', reward: '邻居收件名单', icon: '▤',
        hints: ['课堂里的书夹着一张取景模板。', '将模板四角与作业纸对齐，只读开窗位置。', '按从上到下、从左到右读取，得到381。'] },
    { id: 'parcel', room: '楼道取件架', title: '这袋是谁的', time: '2020/03/16 17:00', word: '来', requires: 'homework', reward: '取件合影', icon: '▧',
        hints: ['名单把人名与门牌联系起来，聊天记录决定每个人的物品。', '先确定阿圆，再用“小林不要水”排除。', '301胶带，302纸张，303矿泉水。'] },
    { id: 'rhythm', room: '暑假拍摄角', title: '丢失的四拍', time: '2019/07/20 15:00', word: '把', requires: null, reward: '四张变装底片', icon: '♫',
        hints: ['看电视旁的四张分镜，从左到右读。', '左右以观看屏幕的你为准，杯子表示休息。', '顺序是左、右、休息、右。'] },
    { id: 'outfit', room: '拍同款角', title: '草稿箱里的转场', time: '2019/07/20 16:00', word: '今', requires: 'rhythm', reward: '窗户读取便签', icon: '✋',
        hints: ['对比衣服和手掌与镜头的距离。', '先穿校服露脸，再遮住镜头，黑场后换成外套。', '按A、B、C、D排列底片。'] },
    { id: 'chorus', room: '阳台暗号', title: '对面的灯还亮着', time: '2019/07/20 19:00', word: '天', requires: 'outfit', reward: '阳台夜景', icon: '▦',
        hints: ['草稿箱便签告诉你从哪一层开始读。', '先底层后上层，每层从左到右，只读亮窗。', '亮窗依次是6、1、9、2，输入6192。'] },
];

export class EscapeGame {
    constructor() {
        this.phase = 'ready';
        this.remaining = 1200;
        this.solved = [];
        this.channels = { home: true, lesson: true, alert: true };
        this.hints = {};
        this.attempts = {};
    }

    start() {
        if (this.phase === 'ready') {
            this.phase = 'playing';
        }
    }

    pause() {
        if (this.phase === 'playing') {
            this.phase = 'paused';
        }
    }

    resume() {
        if (this.phase === 'paused') {
            this.phase = 'playing';
        }
    }

    tick(seconds) {
        if (this.phase !== 'playing') {
            return;
        }
        this.remaining = Math.max(0, this.remaining - Math.max(0, seconds));
        if (this.remaining === 0) {
            this.phase = 'lost';
        }
    }

    isUnlocked(id) {
        const puzzle = PUZZLES.find(item => item.id === id);
        return Boolean(puzzle && (!puzzle.requires || this.solved.includes(puzzle.requires)));
    }

    toggleChannel(id) {
        if (this.phase === 'playing' && Object.hasOwn(this.channels, id)) {
            this.channels[id] = !this.channels[id];
        }
    }

    solve(id, answer) {
        if (this.phase !== 'playing') {
            return { ok: false, message: '先回到正在进行的游戏。' };
        }
        if (!this.isUnlocked(id)) {
            return { ok: false, message: '还缺少上一处留下的线索，先看看其他房间。' };
        }
        if (this.solved.includes(id)) {
            return { ok: true, message: '这段记忆已经找到，可以再次阅读线索。' };
        }
        let correct = false;
        if (id === 'mic') {
            correct = !this.channels.home && this.channels.lesson && answer === 'blue';
        } else if (id === 'homework') {
            correct = String(answer).trim() === '381';
        } else if (id === 'parcel') {
            correct = same(answer, ['tape', 'paper', 'water']);
        } else if (id === 'rhythm') {
            correct = same(answer, ['L', 'R', 'P', 'R']);
        } else if (id === 'outfit') {
            correct = same(answer, ['A', 'B', 'C', 'D']);
        } else if (id === 'chorus') {
            correct = String(answer).trim() === '6192';
        }
        this.attempts[id] = (this.attempts[id] || 0) + 1;
        if (!correct) {
            return { ok: false, message: '还没有对上。线索都在现场，可以重新比较。' };
        }
        this.solved.push(id);
        return { ok: true, message: '找到一张当天的照片。新线索已放入手记。' };
    }

    hint(id) {
        if (this.phase !== 'playing' || !this.isUnlocked(id)) {
            return { ok: false, message: '先取得这一处需要的线索。' };
        }
        const puzzle = PUZZLES.find(item => item.id === id);
        const level = Math.min(3, (this.hints[id] || 0) + 1);
        this.hints[id] = level;
        return { ok: true, level, message: puzzle.hints[level - 1] };
    }

    archive(order) {
        if (this.phase !== 'playing' || this.solved.length !== PUZZLES.length) {
            return { ok: false, message: '先找齐六张照片，再恢复当天的时间线。' };
        }
        const chronological = [...PUZZLES].sort((a, b) => a.time.localeCompare(b.time)).map(item => item.id);
        if (!same(order, chronological)) {
            return { ok: false, message: '时间线还没连起来。比较照片上的拍摄时间。' };
        }
        this.phase = 'won';
        return { ok: true, message: '把今天存下来。' };
    }
}
