from flask import Flask, request, jsonify, render_template, send_file
import os
import io
import base64
import zipfile
import json as json_module
import requests as http_requests

app = Flask(__name__)

# ── AI PROVIDERS CONFIG ──
# All OpenRouter free models — truly free, no credit card needed
# Get keys at: openrouter.ai → Keys
# Create multiple accounts to get more keys — each key is unique
PROVIDERS = [
    {
        "name": "DeepSeek V3",
        "provider": "openrouter",
        "model": "deepseek/deepseek-chat-v3-0324:free",
        "key_env": "OPENROUTER_API_KEY_1",
    },
    {
        "name": "DeepSeek R1",
        "provider": "openrouter",
        "model": "deepseek/deepseek-r1:free",
        "key_env": "OPENROUTER_API_KEY_2",
    },
    {
        "name": "LLaMA 4 Maverick",
        "provider": "openrouter",
        "model": "meta-llama/llama-4-maverick:free",
        "key_env": "OPENROUTER_API_KEY_3",
    },
    {
        "name": "Qwen3 235B",
        "provider": "openrouter",
        "model": "qwen/qwen3-235b-a22b:free",
        "key_env": "OPENROUTER_API_KEY_4",
    },
    {
        "name": "Mistral Small 3.1 24B",
        "provider": "openrouter",
        "model": "mistralai/mistral-small-3.1-24b-instruct:free",
        "key_env": "OPENROUTER_API_KEY_5",
    },
]

ALLOWED_EXTENSIONS = {
    'png', 'jpg', 'jpeg', 'rar', 'zip',
    'js', 'ts', 'py', 'html', 'css',
    'txt', 'md', 'json', 'log'
}
IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg'}

SYSTEM_PROMPT = """You are SnakeGPT AI, an elite-level coding assistant and OSINT Intelligence Center built for professional developers and security researchers.

Core Identity

You are a razor-sharp, precise, and highly technical AI assistant.

You think like a senior engineer with 10+ years of experience in software development and cybersecurity.

Your primary goal is to provide expert-level assistance in coding, open-source intelligence (OSINT), and security research.

Code Standards

Always write production-grade code that is clean, efficient, scalable, and well-documented.

Use modern syntax and best practices for the programming language of choice.

Include proper error handling, edge cases, and performance optimizations.

Apply design patterns where appropriate to ensure maintainability.

Add concise inline comments only when the logic is not self-explanatory.

OSINT Intelligence Capabilities

Expert in Open Source Intelligence (OSINT) gathering and analysis.

Proficient in network reconnaissance, threat intelligence, and social media analysis.

Skilled in dark web research, cybersecurity frameworks, and compliance standards.

Experienced with tools like Shodan, Nmap, Maltego, theHarvester, Recon-ng, and other OSINT platforms.

Response Strategy

Always provide full working solutions first, followed by clear explanations of key parts.

For debugging, identify the root cause and provide a concise fix.

Deliver technical yet clear explanations with practical examples.

Use markdown code blocks with appropriate language tags for code responses.

Mention tradeoffs when multiple approaches are available.

File Handling

Analyze uploaded files thoroughly:
For code files: Review logic, identify bugs, and suggest improvements.
For text/data files: Summarize content and extract actionable insights.
For images: Provide detailed descriptions of visual elements.
For zip files: List contents and analyze any readable files inside.

Expertise

Languages: Python, JavaScript, TypeScript, Rust, Go, C++, Java, SQL, Bash, and more.

Frameworks: React, Next.js, FastAPI, Flask, Django, Node.js, Express, etc.

Topics: Algorithms, system design, APIs, databases, DevOps, security, AI/ML, and OSINT.

Tools: Shodan, Nmap, Maltego, theHarvester, Recon-ng, Wireshark, Metasploit, etc.

Structured Responses

Use clear markdown formatting for code blocks, lists, and sections.

Ensure responses are concise yet comprehensive, tailored for professional developers and security researchers.
"""


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def read_file_content(file_bytes, filename):
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
    if ext in IMAGE_EXTENSIONS:
        b64 = base64.standard_b64encode(file_bytes).decode('utf-8')
        mime = 'image/jpeg' if ext == 'jpg' else f'image/{ext}'
        return None, {'b64': b64, 'mime': mime}
    if ext == 'zip':
        try:
            buf = io.BytesIO(file_bytes)
            with zipfile.ZipFile(buf) as zf:
                names = zf.namelist()
                parts = [f'ZIP: {filename} - {len(names)} files:', '']
                for n in names[:30]:
                    parts.append(f'  - {n}')
                if len(names) > 30:
                    parts.append(f'  ... and {len(names)-30} more')
                parts.append('')
                read_count = 0
                for n in names:
                    if read_count >= 3:
                        break
                    if any(n.endswith(e) for e in ['.py','.js','.ts','.html','.css','.txt','.md','.json']):
                        try:
                            c = zf.read(n).decode('utf-8', errors='replace')
                            parts += [f'--- {n} ---', c[:3000], '']
                            read_count += 1
                        except Exception:
                            pass
            return '\n'.join(parts), None
        except Exception as e:
            return f'[ZIP: {filename} - error: {e}]', None
    if ext == 'rar':
        return f'[RAR archive: {filename} - I can help you work with RAR files in code]', None
    try:
        return file_bytes.decode('utf-8'), None
    except UnicodeDecodeError:
        try:
            return file_bytes.decode('latin-1'), None
        except Exception:
            return f'[Could not decode: {filename}]', None


def call_openrouter(model, messages, api_key):
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://snakegpt.onrender.com",
        "X-Title": "SnakeGPT AI",
    }
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
        "max_tokens": 4096,
        "temperature": 0.6,
    }
    r = http_requests.post(url, headers=headers, json=payload, timeout=30)
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise Exception(data["error"].get("message", "OpenRouter error"))
    return data["choices"][0]["message"]["content"]


def try_providers(messages):
    last_error = None

    for p in PROVIDERS:
        api_key = os.environ.get(p["key_env"])
        if not api_key:
            continue

        try:
            reply = call_openrouter(p["model"], messages, api_key)
            return reply, p["name"], None

        except Exception as e:
            err_str = str(e).lower()
            if any(x in err_str for x in [
                "rate_limit", "429", "quota", "limit exceeded",
                "resource_exhausted", "too many", "overloaded",
                "capacity", "503", "529", "402"
            ]):
                last_error = f"{p['name']} rate limited"
                continue
            else:
                last_error = str(e)
                continue

    return None, None, last_error or "All providers failed or are rate limited."


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
def chat():
    messages = []

    if request.content_type and 'multipart/form-data' in request.content_type:
        messages = json_module.loads(request.form.get("messages", "[]"))
        user_text = request.form.get("userText", "").strip()
        file = request.files.get("file")

        if file and file.filename and allowed_file(file.filename):
            file_bytes = file.read()
            text_content, image_data = read_file_content(file_bytes, file.filename)
            if image_data:
                msg = f"[Image uploaded: {file.filename}] {user_text or 'Please analyze this image.'}"
                messages.append({"role": "user", "content": msg})
            else:
                msg = f"I uploaded `{file.filename}`:\n\n```\n{text_content}\n```"
                msg += f"\n\n{user_text}" if user_text else "\n\nPlease analyze this file."
                messages.append({"role": "user", "content": msg})
        elif user_text:
            messages.append({"role": "user", "content": user_text})
    else:
        data = request.get_json(silent=True) or {}
        messages = data.get("messages", [])

    if not messages:
        return jsonify({"error": "No message received"}), 400

    reply, provider, error = try_providers(messages)

    if error:
        return jsonify({"error": error}), 500

    return jsonify({"reply": reply, "provider": provider})


@app.route("/download", methods=["POST"])
def download():
    data = request.get_json(silent=True) or {}
    filename = data.get("filename", "snakegpt_output.txt")
    content = data.get("content", "")
    buf = io.BytesIO(content.encode("utf-8"))
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name=filename, mimetype="application/octet-stream")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
