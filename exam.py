"""Rules and private role views for the local nostalgia exam prototype."""
import copy
import math
import secrets
import threading
import time

QUESTIONS = [
    {'id': 'q1', 'section': 'QQ 空间记忆', 'prompt': '好友农场里的菜成熟了，大家最惦记的操作叫？', 'options': ['蹭饭', '偷菜', '抢车位', '浇水'], 'answer': 1, 'explanation': 'QQ 农场里的“偷菜”，是很多人的定时上线理由。', 'note': 'QQ 农场：成熟的作物可以收获，也可以去好友家偷菜。'},
    {'id': 'q2', 'section': 'QQ 空间记忆', 'prompt': 'QQ 等级里，几个“月亮”可以合成一个“太阳”？', 'options': ['2 个', '3 个', '4 个', '5 个'], 'answer': 2, 'explanation': '4 个星星是一个月亮，4 个月亮是一个太阳。', 'note': 'QQ 等级：4 星＝1 月亮；4 月亮＝1 太阳；4 太阳＝1 皇冠。'},
    {'id': 'q3', 'section': '经典表情包', 'prompt': '“葛优躺”这张经典截图，出自哪部电视剧？', 'image': 'assets/memes/077.gif', 'options': ['家有儿女', '我爱我家', '武林外传', '编辑部的故事'], 'answer': 1, 'explanation': '葛优在《我爱我家》中饰演纪春生，瘫在沙发上的截图成为经典。', 'note': '葛优躺：来自电视剧《我爱我家》，角色叫纪春生。'},
    {'id': 'q4', 'section': '经典表情包', 'prompt': '“雨女无瓜”用普通话还原，最接近哪一句？', 'image': 'assets/memes/038.jpg', 'options': ['与你无关', '雨天无瓜', '有你真好', '你又管我'], 'answer': 0, 'explanation': '“雨女无瓜”是“与你无关”的谐音梗。', 'note': '雨女无瓜＝与你无关；你怎么这个亚子＝你怎么这个样子。'},
    {'id': 'q5', 'section': '那几年上网', 'prompt': '疫情网课期间，哪款应用曾因“小学生组团打一星”成为热门话题？', 'options': ['微信', '钉钉', 'QQ 音乐', '百度网盘'], 'answer': 1, 'explanation': '当时钉钉因网课和一星评价成为网络讨论话题。', 'note': '网课回忆：钉钉曾因学生打低分走红，“钉钉求饶”也是相关记忆。'},
    {'id': 'q6', 'section': '那几年上网', 'prompt': '补全这句梗：“年轻人，你不讲＿＿。”', 'options': ['道理', '武德', '礼貌', '规矩'], 'answer': 1, 'explanation': '“不讲武德”和“我大意了，没有闪”是同一组常见网络梗。', 'note': '马保国相关梗：“年轻人不讲武德”“我大意了，没有闪”“耗子尾汁”。'},
    {'id': 'q7', 'section': '视频时代', 'prompt': '补全这句打工人暗号：“三点几啦，饮＿＿先啦！”', 'options': ['水', '酒', '茶', '奶'], 'answer': 2, 'explanation': '“三点几啦，饮茶先啦”常被用来表达先休息一下。', 'note': '三点几啦，饮茶先啦：到点了，先喝茶休息一下。'},
    {'id': 'q8', 'section': '视频时代', 'prompt': 'B 站的“一键三连”，通常指哪三个操作？', 'options': ['点赞、评论、转发', '点赞、投币、收藏', '关注、评论、收藏', '投币、分享、关注'], 'answer': 1, 'explanation': '点赞、投币、收藏，合起来通常叫“三连”。', 'note': 'B 站一键三连：点赞＋投币＋收藏；不包含转发或关注。'},
]
NOTES = [{'id': f'n{index + 1}', 'question_id': question['id'], 'title': f'记忆碎片 {index + 1:02d} · {question["section"]}', 'text': question['note']} for index, question in enumerate(QUESTIONS)]


class ExamError(ValueError):
    pass


class ExamRooms:
    def __init__(self, clock=time.time):
        self.clock = clock
        self.rooms = {}
        self.lock = threading.RLock()

    def create(self, settings):
        with self.lock:
            mode = settings.get('mode', 'solo')
            names = settings.get('names', ['我', '小林', '阿圆', '大壮'])
            if mode not in ('solo', 'multi') or not isinstance(names, list) or not 2 <= len(names) <= 6:
                raise ExamError('请选择单人或多人模式，并设置 2—6 名学生。')
            if any(not isinstance(name, str) or not name.strip() or len(name) > 12 for name in names):
                raise ExamError('每个学生名字需要 1—12 个字。')
            review_seconds = settings.get('review_seconds', 90)
            exam_seconds = settings.get('exam_seconds', 300)
            if type(review_seconds) is not int or not 10 <= review_seconds <= 600 or type(exam_seconds) is not int or not 30 <= exam_seconds <= 1800:
                raise ExamError('复习需 10—600 秒，考试需 30—1800 秒。')
            now = self.clock()
            self.rooms = {key: room for key, room in self.rooms.items() if now - room['created_at'] < 21600}
            if len(self.rooms) >= 64:
                raise ExamError('当前考场太多，请重启本地服务清空旧考场。')
            room_id = secrets.token_hex(3).upper()
            while room_id in self.rooms:
                room_id = secrets.token_hex(3).upper()
            students = []
            for index, name in enumerate(names):
                students.append({'id': f's{index + 1}', 'name': name.strip(), 'token': secrets.token_urlsafe(18), 'bot': mode == 'solo' and index > 0,
                                 'notes': [note['id'] for position, note in enumerate(NOTES) if position % len(names) == index],
                                 'answers': {}, 'activity': None, 'inbox': [], 'caught': 0, 'submitted': False, 'joined': False})
            room = {'id': room_id, 'mode': mode, 'created_at': now, 'phase': 'lobby', 'host_token': secrets.token_urlsafe(24), 'students': students,
                    'review_seconds': review_seconds, 'exam_seconds': exam_seconds, 'deadline': None, 'exam_started_at': None,
                    'observing': None, 'last_move': -math.inf, 'catches': 0, 'events': []}
            self.rooms[room_id] = room
            token = students[0]['token'] if mode == 'solo' else room['host_token']
            return {'id': room_id, 'token': token}

    def _identity(self, room_id, token):
        room = self.rooms.get(room_id)
        if room is None:
            raise ExamError('考场不存在或已过期。重启服务后需要重新开局。')
        if token == room['host_token']:
            return room, None
        for student in room['students']:
            if token == student['token']:
                student['joined'] = True
                return room, student
        raise ExamError('入场链接无效，请使用主持人提供的完整链接。')

    def _monitor(self, room, at):
        if room['mode'] == 'solo' and room['exam_started_at'] is not None:
            index = (int(max(0, at - room['exam_started_at']) // 4) + 1) % len(room['students'])
            return room['students'][index]['id']
        return room['observing'] if at - room['last_move'] >= 2 else None

    def _confiscate(self, room, student, at):
        activity = student['activity']
        note_id = activity.get('note_id')
        if note_id not in student['notes']:
            note_id = student['notes'][0] if student['notes'] else None
        if note_id:
            student['notes'].remove(note_id)
        student['activity'] = None
        student['caught'] += 1
        room['catches'] += 1
        if activity['kind'] == 'lean':
            description = '探头看邻桌'
        elif activity['kind'] == 'peek':
            description = '查看资料'
        else:
            description = '传递信息'
        room['events'].insert(0, {'name': student['name'], 'message': description, 'confiscated': note_id is not None, 'at': at})

    def _finish(self, room):
        for student in room['students']:
            student['activity'] = None
            if student['bot']:
                seat = int(student['id'][1:])
                for index, question in enumerate(QUESTIONS):
                    if question['id'] not in student['answers']:
                        student['answers'][question['id']] = question['answer'] if (index + seat) % 4 else (question['answer'] + 1) % 4
            student['submitted'] = True
        room['phase'] = 'results'
        room['deadline'] = None

    def _tick(self, room):
        now = self.clock()
        if room['phase'] == 'review' and now >= room['deadline']:
            self._start(room, room['deadline'])
        if room['phase'] != 'exam':
            return
        until = min(now, room['deadline'])
        for student in room['students']:
            if student['bot']:
                for index, question in enumerate(QUESTIONS):
                    owns_note = NOTES[index]['id'] in student['notes']
                    if owns_note or until - room['exam_started_at'] >= (index + 1) * 12:
                        student['answers'][question['id']] = question['answer'] if owns_note or (index + int(student['id'][1:])) % 4 else (question['answer'] + 1) % 4
        for student in room['students']:
            activity = student['activity']
            if not activity:
                continue
            if room['mode'] == 'solo':
                first_slot = int(max(0, activity['started_at'] - room['exam_started_at']) // 4)
                last_slot = int(max(0, min(until, activity['ends_at']) - room['exam_started_at']) // 4)
                for slot in range(first_slot, last_slot + 1):
                    instant = max(activity['started_at'], room['exam_started_at'] + slot * 4)
                    if instant < activity['ends_at'] and instant <= until and self._monitor(room, instant) == student['id']:
                        self._confiscate(room, student, instant)
                        break
            if student['activity'] and until >= activity['ends_at']:
                if activity['kind'] == 'share':
                    recipient = next(item for item in room['students'] if item['id'] == activity['recipient_id'])
                    if not recipient['submitted']:
                        recipient['inbox'].append({'from': student['name'], 'message': activity['message']})
                if activity['kind'] == 'ask':
                    note = next(note for note in NOTES if note['id'] == activity['note_id'])
                    student['inbox'].append({'from': activity['from_name'], 'message': note['text']})
                student['activity'] = None
        if now >= room['deadline']:
            self._finish(room)

    def _start(self, room, at):
        room['phase'] = 'exam'
        room['exam_started_at'] = at
        room['deadline'] = at + room['exam_seconds']

    def act(self, room_id, token, payload):
        with self.lock:
            room, student = self._identity(room_id, token)
            self._tick(room)
            action = payload.get('action')
            controls = student is None or room['mode'] == 'solo'
            now = self.clock()
            if action in ('review', 'start', 'finish'):
                if not controls:
                    raise ExamError('只有监考可以推进考场阶段。')
                expected = {'review': 'lobby', 'start': 'review', 'finish': 'exam'}[action]
                if room['phase'] != expected:
                    raise ExamError('当前阶段不能进行这个操作。')
                if action == 'review':
                    room['phase'] = 'review'
                    room['deadline'] = now + room['review_seconds']
                elif action == 'start':
                    self._start(room, now)
                else:
                    self._finish(room)
            elif action in ('observe', 'catch'):
                if student is not None or room['phase'] != 'exam':
                    raise ExamError('只有考试中的监考可以巡视和抓现行。')
                target = next((item for item in room['students'] if item['id'] == payload.get('student_id')), None)
                if not target:
                    raise ExamError('这名学生不在考场。')
                if action == 'observe':
                    if now - room['last_move'] < 2:
                        raise ExamError('正在走向另一张课桌，请稍等。')
                    room['observing'] = target['id']
                    room['last_move'] = now
                else:
                    if self._monitor(room, now) != target['id'] or not target['activity']:
                        raise ExamError('没有抓到正在进行的动作，不能没收资料。')
                    self._confiscate(room, target, now)
            else:
                if student is None or room['phase'] != 'exam' or student['submitted']:
                    raise ExamError('当前不能作答或使用资料。')
                if action == 'answer':
                    question = next((question for question in QUESTIONS if question['id'] == payload.get('question_id')), None)
                    choice = payload.get('choice')
                    if not question or type(choice) is not int or not 0 <= choice < len(question['options']):
                        raise ExamError('无效的题目或选项。')
                    student['answers'][question['id']] = choice
                elif action == 'submit':
                    student['submitted'] = True
                    student['activity'] = None
                    if all(item['submitted'] or item['bot'] for item in room['students']):
                        self._finish(room)
                elif action == 'close':
                    student['activity'] = None
                elif action in ('peek', 'share', 'ask', 'lean'):
                    if student['activity']:
                        raise ExamError('先收起当前资料或等纸条传完。')
                    activity = {'kind': action, 'started_at': now, 'ends_at': now + (20 if action in ('peek', 'lean') else 4)}
                    if action == 'lean':
                        direction = payload.get('direction')
                        columns = 2 if len(room['students']) <= 4 else 3
                        index = room['students'].index(student)
                        if direction not in ('left', 'right'):
                            raise ExamError('请选择向左或向右探头。')
                        neighbor_index = index + (-1 if direction == 'left' else 1)
                        if neighbor_index < 0 or neighbor_index >= len(room['students']) or neighbor_index // columns != index // columns:
                            raise ExamError('这一边没有同桌，换个方向试试。')
                        activity.update(direction=direction, neighbor_id=room['students'][neighbor_index]['id'])
                    elif action == 'peek':
                        if payload.get('note_id') not in student['notes']:
                            raise ExamError('这份资料已经不在你的抽屉里。')
                        activity['note_id'] = payload['note_id']
                    elif action == 'share':
                        recipient = next((item for item in room['students'] if item['id'] == payload.get('recipient_id') and item['id'] != student['id']), None)
                        message = payload.get('message', '')
                        if not recipient or recipient['submitted'] or not isinstance(message, str) or not message.strip() or len(message) > 120:
                            raise ExamError('请选择未交卷的同学，纸条写 1—120 个字。')
                        activity.update(recipient_id=recipient['id'], message=message.strip())
                    else:
                        if room['mode'] != 'solo':
                            raise ExamError('多人模式请通过纸条向真人同学传递信息。')
                        note = next((note for note in NOTES if note['question_id'] == payload.get('question_id')), None)
                        owner = next((item for item in room['students'] if item['bot'] and note and note['id'] in item['notes']), None)
                        if not owner:
                            raise ExamError('同学没有这题的资料，看看自己的抽屉。')
                        activity.update(note_id=note['id'], from_name=owner['name'])
                    student['activity'] = activity
                else:
                    raise ExamError('未知的考场操作。')
            return self.view(room_id, token)

    def view(self, room_id, token):
        with self.lock:
            room, student = self._identity(room_id, token)
            self._tick(room)
            now = self.clock()
            result = {key: room[key] for key in ('id', 'mode', 'phase', 'review_seconds', 'exam_seconds', 'catches')}
            result['remaining'] = max(0, math.ceil(room['deadline'] - now)) if room['deadline'] else 0
            result['role'] = 'student' if student else 'teacher'
            result['self_id'] = student['id'] if student else None
            result['observing'] = self._monitor(room, now) if room['phase'] == 'exam' else None
            result['patrol_remaining'] = 4 - int(max(0, now - (room['exam_started_at'] or now))) % 4
            result['teacher_target'] = room['observing'] if room['mode'] == 'multi' else result['observing']
            result['move_remaining'] = math.ceil(max(0, 2 - (now - room['last_move'])))
            result['questions'] = [{key: value for key, value in question.items() if key not in ('answer', 'note', 'explanation')} for question in QUESTIONS]
            result['students'] = [{'id': item['id'], 'name': item['name'], 'bot': item['bot'], 'joined': item['joined'], 'submitted': item['submitted'], 'answered': len(item['answers']), 'caught': item['caught'], 'note_count': len(item['notes'])} for item in room['students']]
            result['events'] = room['events'][:12]
            if student:
                result['answers'] = dict(student['answers'])
                result['drawer'] = [{'id': note['id'], 'title': note['title'], 'question_id': note['question_id']} for note in NOTES if note['id'] in student['notes']]
                result['notes'] = [dict(note) for note in NOTES if note['id'] in student['notes']] if room['phase'] == 'review' else []
                result['inbox'] = copy.deepcopy(student['inbox'])
                result['caught'] = student['caught']
                result['submitted'] = student['submitted']
                result['activity'] = None
                activity = student['activity']
                if activity:
                    note = next((note for note in NOTES if note['id'] == activity.get('note_id')), None)
                    result['activity'] = {'kind': activity['kind'], 'remaining': max(0, math.ceil(activity['ends_at'] - now)), 'ready': now - activity['started_at'] >= 2,
                                          'note': dict(note) if note and activity['kind'] == 'peek' and now - activity['started_at'] >= 2 else None,
                                          'direction': activity.get('direction'), 'recipient_id': activity.get('recipient_id'), 'neighbor': None}
                    if activity['kind'] == 'lean' and now - activity['started_at'] >= 2:
                        neighbor = next(item for item in room['students'] if item['id'] == activity['neighbor_id'])
                        result['activity']['neighbor'] = {'name': neighbor['name'], 'answers': dict(neighbor['answers'])}
            else:
                result['invites'] = [{'student_id': item['id'], 'name': item['name'], 'token': item['token']} for item in room['students']]
                observed = next((item for item in room['students'] if item['id'] == self._monitor(room, now)), None)
                result['observed'] = None
                if observed and room['phase'] == 'exam':
                    result['observed'] = {'id': observed['id'], 'name': observed['name'], 'action': observed['activity']['kind'] if observed['activity'] else None, 'direction': observed['activity'].get('direction') if observed['activity'] else None}
            if room['phase'] == 'results':
                result['results'] = [{'id': item['id'], 'name': item['name'], 'score': sum(10 for question in QUESTIONS if item['answers'].get(question['id']) == question['answer']), 'answered': len(item['answers']), 'caught': item['caught'], 'bot': item['bot'], 'answers': dict(item['answers'])} for item in room['students']]
                result['average'] = round(sum(item['score'] for item in result['results']) / len(result['results']), 1)
                result['answer_key'] = [{key: question[key] for key in ('id', 'answer', 'explanation')} for question in QUESTIONS]
            return result

    def materials(self, room_id, token):
        with self.lock:
            room, student = self._identity(room_id, token)
            if student is not None and room['mode'] != 'solo':
                raise ExamError('线下材料由监考打印。')
            return {'questions': copy.deepcopy(QUESTIONS), 'students': [{'name': item['name'], 'notes': [dict(note) for position, note in enumerate(NOTES) if position % len(room['students']) == index]} for index, item in enumerate(room['students'])]}
