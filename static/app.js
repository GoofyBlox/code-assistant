from flask import Flask, request, jsonify, render_template, send_file
import os
import io
import base64
import zipfile
import json as json_module
import requests as http_requests

app = Flask(__name__)

# ── AI PROVIDERS CONFIG ──
# 4 Together AI (free forever) + 1 Claude (Anthropic)
# Get Together AI keys: api.together.ai → Settings → API Keys
# Get Claude key: console.anthropic.com → API Keys
PROVIDERS = [
    # ── TOGETHER AI (free forever, never expires) ──
    {
        "name": "LLaMA 3.3 70B",
        "provider": "together",
        "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
        "key_env": "TOGETHER_API_KEY_1",
    },
    {
        "name": "DeepSeek R1",
        "provider": "together",
        "model": "deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free",
        "key_env": "TOGETHER_API_KEY_2",
    },
    {
        "name": "Qwen 2.5 72B",
        "provider": "together",
        "model": "Qwen/Qwen2.5-72B-Instruct-Turbo",
        "key_env": "TOGETHER_API_KEY_3",
    },
    {
        "name": "Qwen 2.5 Coder 32B",
        "provider": "together",
        "model": "Qwen/Qwen2.5-Coder-32B-Instruct",
        "key_env": "TOGETHER_API_KEY_4",
    },

    # ── CLAUDE (Anthropic) ──
    {
        "name": "Claude Sonnet",
        "provider": "claude",
        "model": "claude-sonnet-4-6",
        "key_env": "ANTHROPIC_API_KEY",
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

Add concise inline comments only when the logic isn’t self-explanatory.

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

## Your Core Identity
- You are razor-sharp, precise, and highly technical
- You write production-grade code â€” clean, efficient, and scalable
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
- Get straight to the point â€” no fluff, no filler
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


# ── PROVIDER CALL FUNCTIONS ──

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


def call_claude(model, messages, api_key):
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    # Convert messages — Claude uses separate system param
    claude_messages = []
    for m in messages:
        role = m["role"] if m["role"] in ["user", "assistant"] else "user"
        content = m["content"] if isinstance(m["content"], str) else str(m["content"])
        claude_messages.append({"role": role, "content": content})

    payload = {
        "model": model,
        "system": SYSTEM_PROMPT,
        "messages": claude_messages,
        "max_tokens": 4096,
    }
    r = http_requests.post(url, headers=headers, json=payload, timeout=30)
    r.raise_for_status()
    data = r.json()
    return data["content"][0]["text"]


def try_providers(messages):
    last_error = None

    for p in PROVIDERS:
        api_key = os.environ.get(p["key_env"])
        if not api_key:
            continue  # skip if key not set

        try:
            if p["provider"] == "together":
                reply = call_together(p["model"], messages, api_key)
            elif p["provider"] == "claude":
                reply = call_claude(p["model"], messages, api_key)
            else:
                continue

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
