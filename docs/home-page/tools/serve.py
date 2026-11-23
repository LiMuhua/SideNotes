"""本地预览官网：与 GitHub Pages 一样以 /SideNotes/ 为根目录，找不到的地址返回 404.html。

每个响应都带 Cache-Control: no-store，改完文件刷新页面就是新的，不会用到浏览器缓存的旧样式与脚本。
用法（仓库根目录）：python -I docs/home-page/tools/serve.py [端口，默认 1440]
然后打开 http://127.0.0.1:1440/SideNotes/
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "public"
PREFIX = "/SideNotes"


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        # 根地址转到 /SideNotes/，与线上的地址一致（404 页里的绝对路径也以它开头）。
        if self.path in ("", "/"):
            self.send_response(302)
            self.send_header("Location", PREFIX + "/")
            self.end_headers()
            return
        super().do_GET()

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean == PREFIX or clean.startswith(PREFIX + "/"):
            clean = clean[len(PREFIX):] or "/"
        return super().translate_path(clean)

    def send_error(self, code, message=None, explain=None):
        # 与 GitHub Pages 一样，找不到的地址显示 404.html。
        page = ROOT / "404.html"
        if code == 404 and page.exists():
            body = page.read_bytes()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)


def main():
    # 输出给管道（例如编辑器的预览面板）时也用 UTF-8，中文不乱码。
    sys.stdout.reconfigure(encoding="utf-8")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 1440
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT)))
    print(f"官网预览：http://127.0.0.1:{port}{PREFIX}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
