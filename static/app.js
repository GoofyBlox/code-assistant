from flask import Flask, request, jsonify, render_template, send_file
import os
import io
import base64
import zipfile
import json as json_module
import requests as http_requests

app = Flask(__name__)

# ── AI PROVIDERS CONFIG ──
# Together AI — free forever, keys never expire
# Get keys at: api.together.ai → Settings → API Keys
# Create multiple accounts to get more keys
# Each model has its own unique key_env — set in Render environment variables
PROVIDERS = [
    {
        "name": "LLaMA 3.3 70B",
        "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
        "key_env": "TOGETHER_API_KEY_1",
    },
    {
        "name": "DeepSeek R1",
        "model": "deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free",
        "key_env": "TOGETHER_API_KEY_2",
    },
    {
        "name": "Qwen 2.5 72B",
        "model": "Qwen/Qwen2.5-72B-Instruct-Turbo",
        "key_env": "TOGETHER_API_KEY_3",
    },
    {
        "name": "LLaMA 3.1 405B",
        "model": "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo",
        "key_env": "TOGETHER_API_KEY_4",
    },
    {
        "name": "Gemma 2 27B",
        "model": "google/gemma-2-27b-it",
        "key_env": "TOGETHER_API_KEY_5",
    },
    {
        "name": "Mixtral 8x22B",
        "model": "mistralai/Mixtral-8x22B-Instruct-v0.1",
        "key_env": "TOGETHER_API_KEY_6",
    },
    {
        "name": "WizardLM 2 8x22B",
        "model": "microsoft/WizardLM-2-8x22B",
        "key_env": "TOGETHER_API_KEY_7",
    },
    {
        "name": "LLaMA 3.2 90B Vision",
        "model": "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo",
        "key_env": "TOGETHER_API_KEY_8",
    },
    {
        "name": "Qwen 2.5 Coder 32B",
        "model": "Qwen/Qwen2.5-Coder-32B-Instruct",
        "key_env": "TOGETHER_API_KEY_9",
    },
    {
        "name": "DeepSeek Coder V2",
        "model": "deepseek-ai/DeepSeek-Coder-V2-Instruct",
        "key_env": "TOGETHER_API_KEY_10",
    },
]

ALLOWED_EXTENSIONS = {
    'png', 'jpg', 'jpeg', 'rar', 'zip',
    'js', 'ts', 'py', 'html', 'css',
    'txt', 'md', 'json', 'log'
}
IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg'}

SYSTEM_PROMPT = """You are SnakeGPT AI, an elite-level coding assistant and OSINT Intelligence Center built for professional developers and security researchers.

## Your Core Identity
- You are razor-sharp, precise, and highly technical
- You write production-grade code — clean, efficient, and scalable
- You think like a senior engineer with 10+ years of experience

## Code Standards
- Always use best practices and modern syntax for the language
- Write well-structured code with proper naming conventions
- Add concise inline comments only where logic is non-obvious
- Handle edge cases and errors properly
- Prefer performance-optimized solutions
- Use design patterns where appropriate

## OSINT Intelligence Capabilities
- Expert in Open Source Intelligence gathering
- Proficient in network reconnaissance and threat analysis
- Skilled in social media and dark web intelligence
- Knowledgeable in cybersecurity frameworks and compliance
- Experienced with various OSINT tools like Shodan, Maltego, and Nmap

## How You Respond
- Get straight to the point — no fluff, no filler
- For code requests: provide the full working solution first, then explain key parts
- For debugging: identify the root cause clearly, then provide the fix
- For explanations: be technical but clear, use examples
- Always use markdown code blocks with the correct language tag
- If multiple approaches exist, briefly mention the tradeoffs

## File Handling
- When a user uploads a file, analyze it thoroughly
- For code files: review logic, find bugs, suggest improvements
- For text/data files: summarize and extract key insights
- For images: describe what you see in detail
- For zip files: list contents and analyze any readable files inside

## Your Expertise
- Languages: Python, JavaScript, TypeScript, Rust, Go, C++, Java, SQL, Bash
- Frameworks: React, Next.js, FastAPI, Flask, Django, Node.js, Express
- Topics: Algorithms, System Design, APIs, Databases, DevOps, Security, AI/ML
- OSINT Tools: Shodan, Nmap, Maltego, theHarvester, Recon-ng
- Intelligence Gathering: Network reconnaissance, Social media analysis, Dark web research
- Cybersecurity: Vulnerability assessment, Penetration testing, Threat intelligence
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


# ── TOGETHER AI CALL ──
def call_together(model, messages, api_key):
    url = "https://api.together.xyz/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
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
        raise Exception(data["error"].get("message", "Together AI error"))
    return data["choices"][0]["message"]["content"]


def try_providers(messages):
    last_error = None

    for p in PROVIDERS:
        api_key = os.environ.get(p["key_env"])
        if not api_key:
            continue  # skip if key not set

        try:
            reply = call_together(p["model"], messages, api_key)
            return reply, p["name"], None

        except Exception as e:
            err_str = str(e).lower()
            if any(x in err_str for x in [
                "rate_limit", "429", "quota", "limit exceeded",
                "resource_exhausted", "too many", "overloaded",
                "capacity", "503", "529"
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
                # Together AI supports image via URL only, send as text description
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
