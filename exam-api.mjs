export const examHost = {
    label: '网页试玩',
    persistence: '房间存在当前浏览器的网站数据中，刷新可恢复；清除网站数据后删除。',
    note: '免安装，考试规则在你的浏览器中运行。真人考场仅限同一浏览器的多个标签页，无法跨设备联机。首次开局需下载运行组件；清除网站数据会删除考场。',
    memoryLink: 'memory.html',
    showRelay: false,
};

const stateKey = 'zaoshijie-exam-rooms-v1';
let runtimePromise;

async function loadRuntime() {
    const { loadPyodide } = await import('./runtime/pyodide.mjs');
    const runtime = await loadPyodide({ indexURL: new URL('./runtime/', import.meta.url).href });
    for (const name of ['exam.py', 'exam_browser_bridge.py']) {
        const response = await fetch(new URL(name, import.meta.url));
        if (!response.ok) {
            throw new Error('考试组件未能加载，请刷新后重试。');
        }
        runtime.FS.writeFile(`/home/pyodide/${name}`, await response.text());
    }
    runtime.runPython('import json\nfrom exam_browser_bridge import dispatch');
    return runtime;
}

export async function api(path, payload) {
    if (!navigator.locks) {
        throw new Error('请使用新版 Chrome、Edge 或 Safari，在 HTTPS 页面打开试玩。');
    }
    const button = document.querySelector('[data-action="solo"]');
    const originalText = button?.textContent;
    if (!runtimePromise) {
        if (button) {
            button.textContent = '首次打开，正在准备考场……';
        }
        runtimePromise = loadRuntime().catch(error => {
            runtimePromise = null;
            throw error;
        });
    }
    let runtime;
    try {
        runtime = await runtimePromise;
    } finally {
        if (button && originalText) {
            button.textContent = originalText;
        }
    }
    return navigator.locks.request(stateKey, () => {
        runtime.globals.set('browser_state', localStorage.getItem(stateKey) || '{}');
        runtime.globals.set('browser_path', path);
        runtime.globals.set('browser_payload', JSON.stringify(payload ?? null));
        const response = JSON.parse(runtime.runPython('json.dumps(dispatch(browser_state, browser_path, json.loads(browser_payload)), ensure_ascii=False)'));
        localStorage.setItem(stateKey, response.state);
        if (!response.ok) {
            throw new Error(response.error);
        }
        return response.data;
    });
}
