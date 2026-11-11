export function classroomLayout(width, height, count) {
    const columns = count <= 4 ? 2 : 3;
    const rows = Math.ceil(count / columns);
    const gridWidth = Math.min(width - 52, columns * 220);
    const cellWidth = gridWidth / columns;
    const deskWidth = Math.min(118, cellWidth - 25);
    const seats = Array.from({ length: count }, (_, index) => ({
        x: (width - gridWidth) / 2 + cellWidth * (index % columns + 0.5),
        y: height * (rows === 1 ? 0.56 : 0.4 + Math.floor(index / columns) * 0.29),
        width: deskWidth,
        height: 59,
    }));
    return { width, height, seats, board: { x: width / 2, y: 43, width: Math.min(width * 0.68, 430) } };
}

export function adjacentSeat(index, direction, count) {
    const columns = count <= 4 ? 2 : 3;
    const target = index + (direction === 'left' ? -1 : 1);
    if (target < 0 || target >= count || Math.floor(target / columns) !== Math.floor(index / columns)) {
        return null;
    }
    return target;
}

export function actionForKey(key, typing, paperOpen) {
    if (typing) {
        return null;
    }
    if (paperOpen) {
        return key === 'Escape' ? 'paper' : null;
    }
    const actions = { e: 'paper', q: 'peek', a: 'left', d: 'right', f: 'message', i: 'inbox', ' ': 'hide', Escape: 'hide' };
    return actions[key.length === 1 ? key.toLowerCase() : key] || null;
}

export class ClassroomRenderer {
    constructor(canvas, { onLayout }) {
        this.canvas = canvas;
        this.context = canvas.getContext('2d');
        this.room = null;
        this.teacher = null;
        this.onLayout = onLayout;
        this.previousFrame = 0;
        this.frame = 0;
        this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas);
        this.animate = this.animate.bind(this);
        this.frame = requestAnimationFrame(this.animate);
    }

    setRoom(room) {
        this.room = room;
        if (!this.layout || this.layout.seats.length !== room.students.length) {
            this.resize();
        }
    }

    resize() {
        if (!this.room) {
            return;
        }
        const bounds = this.canvas.getBoundingClientRect();
        const ratio = Math.min(devicePixelRatio || 1, 2);
        this.canvas.width = Math.round(bounds.width * ratio);
        this.canvas.height = Math.round(bounds.height * ratio);
        this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
        this.layout = classroomLayout(bounds.width, bounds.height, this.room.students.length);
        this.teacher = { x: bounds.width / 2, y: 106 };
        this.onLayout(this.layout);
    }

    destroy() {
        cancelAnimationFrame(this.frame);
        this.resizeObserver.disconnect();
    }

    animate(time) {
        const delta = Math.min(0.05, (time - (this.previousFrame || time)) / 1000);
        this.previousFrame = time;
        if (this.room && this.layout) {
            this.draw(time / 1000, delta);
        }
        this.frame = requestAnimationFrame(this.animate);
    }

    box(x, y, width, height, fill, radius = 3, stroke = null) {
        const context = this.context;
        context.beginPath();
        context.roundRect(x, y, width, height, radius);
        context.fillStyle = fill;
        context.fill();
        if (stroke) {
            context.strokeStyle = stroke;
            context.lineWidth = 1.5;
            context.stroke();
        }
    }

    text(text, x, y, size = 12, color = '#5c6353', align = 'center') {
        const context = this.context;
        context.font = `${size}px "PingFang SC", sans-serif`;
        context.fillStyle = color;
        context.textAlign = align;
        context.fillText(text, x, y);
    }

    draw(time, delta) {
        const context = this.context;
        const { width, height, seats, board } = this.layout;
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#d9c8a7';
        context.fillRect(0, 0, width, height);
        for (let y = 92; y < height; y += 37) {
            context.fillStyle = Math.floor(y / 37) % 2 ? '#dccdae' : '#d4c29e';
            context.fillRect(0, y, width, 36);
            context.strokeStyle = '#b4a28255';
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(width, y);
            context.stroke();
            for (let x = (Math.floor(y / 37) % 2) * 85; x < width; x += 170) {
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(x, y + 37);
                context.stroke();
            }
        }
        this.box(8, 8, width - 16, 85, '#cdd6be', 1, '#9aa98a');
        this.box(board.x - board.width / 2 - 5, 13, board.width + 10, 60, '#9b7950');
        this.box(board.x - board.width / 2, 17, board.width, 51, '#354e42', 1);
        this.text('怀 旧 网 民 摸 底 考 试', board.x, 40, width < 500 ? 12 : 17, '#d9e3ce');
        this.text('保持安静 · 独立作答', board.x, 58, 10, '#a9bea2');
        this.box(board.x + board.width / 2 - 48, 65, 24, 3, '#e1d9bd', 1);
        // Windows and the classroom door are physical landmarks in the overhead room.
        for (const y of [150, 285]) {
            this.box(0, y, 10, 75, '#b1ccca', 1, '#72908c');
            this.box(width - 10, y, 10, 75, '#b1ccca', 1, '#72908c');
        }
        this.box(width - 80, 4, 50, 9, '#9b7950', 1);
        this.text('门', width - 55, 27, 10, '#778568');
        const targetId = this.room.teacher_target || this.room.observing;
        const targetIndex = this.room.students.findIndex(student => student.id === targetId);
        const target = targetIndex >= 0 ? { x: seats[targetIndex].x + seats[targetIndex].width / 2 + 22, y: seats[targetIndex].y + 10 } : { x: width / 2, y: 111 };
        const distance = Math.hypot(target.x - this.teacher.x, target.y - this.teacher.y);
        if (distance > 1) {
            const speed = Math.max(80, distance * 2.5);
            const step = Math.min(1, speed * delta / distance);
            this.teacher.x += (target.x - this.teacher.x) * step;
            this.teacher.y += (target.y - this.teacher.y) * step;
        }
        const watchedIndex = this.room.students.findIndex(student => student.id === this.room.observing);
        if (watchedIndex >= 0) {
            const watched = seats[watchedIndex];
            context.beginPath();
            context.moveTo(this.teacher.x, this.teacher.y);
            context.lineTo(watched.x - watched.width / 2 - 12, watched.y - 35);
            context.lineTo(watched.x + watched.width / 2 + 12, watched.y + 83);
            context.closePath();
            context.fillStyle = '#af553329';
            context.fill();
        }
        seats.forEach((seat, index) => this.drawDesk(seat, this.room.students[index], time));
        this.drawPerson(this.teacher.x, this.teacher.y, '#425f4a', '#b6b1a4', 0, time, true, distance > 2);
        this.text(this.room.role === 'teacher' ? '你 · 监考' : '监考老师', this.teacher.x, this.teacher.y - 32, 10, '#33493b');
        this.text('讲台', width / 2, 107, 9, '#67785f');
        if (this.room.activity?.kind === 'share') {
            const from = this.room.students.findIndex(student => student.id === this.room.self_id);
            const to = this.room.students.findIndex(student => student.id === this.room.activity.recipient_id);
            if (from >= 0 && to >= 0) {
                const progress = (4 - this.room.activity.remaining) / 4;
                const x = seats[from].x + (seats[to].x - seats[from].x) * progress;
                const y = seats[from].y + 59 + (seats[to].y - seats[from].y) * progress;
                context.save();
                context.translate(x, y);
                context.rotate(-0.2);
                this.box(-9, -6, 18, 12, '#fff8dc', 1, '#a99e7b');
                context.restore();
            }
        }
        this.text(this.room.role === 'teacher' ? '点课桌走过去，观察正在发生的小动作' : '你在座位上。探头、翻抽屉、传纸条，别被老师撞见。', width / 2, height - 17, width < 500 ? 9 : 11, '#837254');
    }

    drawDesk(seat, student, time) {
        const context = this.context;
        const watched = this.room.observing === student.id;
        const self = student.id === this.room.self_id;
        const observed = this.room.observed?.id === student.id ? this.room.observed : null;
        const activity = self ? this.room.activity : observed?.action ? { kind: observed.action, direction: observed.direction } : null;
        const lean = activity?.kind === 'lean' ? (activity.direction === 'left' ? -0.65 : 0.65) : 0;
        const bodyX = seat.x + (lean ? Math.sin(lean) * 24 : 0);
        const bodyY = seat.y + 57;
        this.box(seat.x - seat.width / 2 + 4, seat.y - 25, seat.width, 65, '#786d5140', 5);
        if (watched || self) {
            this.box(seat.x - seat.width / 2 - 7, seat.y - 37, seat.width + 14, 120, watched ? '#b94b2b22' : '#526d3a15', 8, watched ? '#b4563e' : '#7d9264');
        }
        this.box(seat.x - seat.width / 2, seat.y - 32, seat.width, 61, '#bd935e', 4, '#896943');
        this.box(seat.x - seat.width / 2 + 5, seat.y - 27, seat.width - 10, 49, '#cfa56a', 3);
        this.box(seat.x - 22, seat.y - 23, 37, 42, '#fffcef', 1, '#c2b696');
        for (let line = 0; line < 5; line++) {
            this.box(seat.x - 16, seat.y - 16 + line * 6, 22 - line % 2 * 5, 1, '#bcbca7', 0);
        }
        this.box(seat.x + seat.width / 2 - 16, seat.y - 23, 8, 20, '#738c7b', 1);
        this.box(seat.x - 24, seat.y + 45, 48, 32, '#9c7853', 5, '#7f6041');
        if (activity?.kind === 'peek') {
            this.box(seat.x - 29, seat.y + 27, 58, 25, '#876641', 3, '#6e5435');
            this.box(seat.x - 19, seat.y + 34, 35, 20, '#f1e3a8', 2);
        }
        this.drawPerson(bodyX, bodyY, self ? '#b65b42' : '#627f91', '#382f29', lean, time, false, Boolean(activity));
        if (activity?.kind === 'ask' || activity?.kind === 'share') {
            this.text('…', bodyX + 30, bodyY - 17, 21, '#73623e');
        }
        this.text(self ? `${student.name} · 你` : student.name, seat.x, seat.y - 45, 11, self ? '#8f3e29' : '#64573e');
        if (student.submitted) {
            this.text('已交卷', seat.x, seat.y + 96, 10, '#5b7753');
        }
        if (watched) {
            this.text('!', seat.x + seat.width / 2 - 4, seat.y - 42, 16, '#a34027');
        }
    }

    drawPerson(x, y, shirt, hair, rotation, time, teacher, moving) {
        const context = this.context;
        context.save();
        context.translate(x, y);
        context.rotate(rotation);
        context.fillStyle = '#79684f30';
        context.beginPath();
        context.ellipse(2, 8, 21, 17, 0, 0, Math.PI * 2);
        context.fill();
        const stride = moving && !this.reducedMotion ? Math.sin(time * 10) * 4 : 0;
        this.box(-12, 6 + stride, 8, 14, '#47514e', 3);
        this.box(5, 6 - stride, 8, 14, '#47514e', 3);
        this.box(-19, -12, 38, 28, shirt, 10);
        this.box(-24, -8, 8, 24, shirt, 4);
        this.box(16, -8, 8, 24, shirt, 4);
        this.box(-24, -12, 7, 9, '#d6ad83', 3);
        this.box(17, -12, 7, 9, '#d6ad83', 3);
        context.fillStyle = '#d9b18b';
        context.beginPath();
        context.ellipse(0, -8, 14, 13, 0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = hair;
        context.beginPath();
        context.ellipse(0, -5, 15, 11, 0, 0, Math.PI * 2);
        context.fill();
        if (teacher) {
            this.box(21, -5, 14, 20, '#68563a', 1);
            this.box(23, -3, 10, 14, '#f0e5c9', 0);
        }
        context.restore();
    }
}
