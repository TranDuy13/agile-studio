# syntax=docker/dockerfile:1
#
# Ảnh chạy Agile Studio: server API/WS + giao diện web đã build, trên MỘT cổng duy nhất.
#
# Ba thứ ảnh này phải mang theo, vì thiếu cái nào là mất một mảng tính năng:
#   * Node        — server và web.
#   * Claude Code CLI — server `spawn("claude")` cho mọi role-agent. Không có nó thì bấm chạy
#                   feature là ENOENT.
#   * Python 3 + python-docx — sidecar `docgen/render.py` xuất .docx. Cài sẵn để khi nhánh docgen
#                   về tới `main` thì ảnh không phải dựng lại; đây cũng là lý do ảnh nền là
#                   `bookworm-slim` chứ không phải `alpine` (python-docx trên musl phải build tay).
#
# ĐĂNG NHẬP nằm ngoài ảnh: credential của Claude Code được mount từ máy host (xem compose.yaml).
# Không bao giờ bake token vào ảnh.

# ------------------------------------------------------------------------------------------------
# Tầng 1 — build giao diện web. Toàn bộ devDependencies (vite, react) chỉ sống ở tầng này.
# ------------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS web-build
WORKDIR /app
RUN corepack enable
# Yarn 4 được ghim qua `packageManager`; release đã commit trong `.yarn/releases` nên không tải global.
COPY .yarnrc.yml package.json yarn.lock ./
COPY .yarn/releases ./.yarn/releases
RUN yarn install --immutable
COPY web ./web
RUN yarn build

# ------------------------------------------------------------------------------------------------
# Tầng 2 — chỉ phụ thuộc chạy thật (dependencies), không có vite/react/concurrently.
# ------------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY .yarnrc.yml package.json yarn.lock ./
COPY .yarn/releases ./.yarn/releases
# ponytail: cài cả devDependencies vào ảnh runtime. Yarn 4 prune prod cần plugin workspace-tools;
# thêm `yarn workspaces focus --production` (sau khi import plugin) nếu kích thước ảnh thành vấn đề.
RUN yarn install --immutable && yarn cache clean

# ------------------------------------------------------------------------------------------------
# Tầng 3 — ảnh chạy.
# ------------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# git: gitscan/scaffold gọi `git` thật trên repo được mount, và Claude Code cũng cần.
# ca-certificates: gọi API Anthropic qua HTTPS.
# python3 + pip: sidecar xuất .docx.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

# Debian bookworm đánh dấu môi trường python là "externally managed" nên pip từ chối cài — cờ này
# là cách gỡ chốt đó. Ở ảnh dùng cho đúng một việc thì không có gói apt nào để mà làm hỏng.
#
# Cố tình KHÔNG dùng venv: venv chỉ hoạt động nhờ nằm đầu PATH, mà `docker exec … bash -l` nạp
# /etc/profile và đặt lại PATH — lúc đó `python3` là bản hệ thống không có python-docx và người
# ta mất nửa buổi tưởng ảnh dựng thiếu. Cài thẳng vào python hệ thống thì mọi shell đều thấy.
RUN pip3 install --no-cache-dir --break-system-packages python-docx==1.1.2

# Claude Code CLI. Ghim phiên bản qua build arg để ảnh dựng lại cho ra đúng thứ đã kiểm;
# `--build-arg CLAUDE_CLI_VERSION=latest` khi muốn bản mới.
ARG CLAUDE_CLI_VERSION=latest
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CLI_VERSION}" && npm cache clean --force

WORKDIR /app

# Ảnh node:* có sẵn user `node` (uid 1000). Chạy bằng user thường, không phải root: tệp sinh ra
# trong repo được mount sẽ không thuộc về root trên máy host.
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
# Chép cả cây nguồn và để .dockerignore lọc, chứ không liệt kê từng thư mục: `docgen/` (sidecar
# Python) chưa có trên nhánh này nhưng sắp về, mà `COPY` một thư mục không tồn tại là lỗi build.
COPY --chown=node:node . ./
COPY --chown=node:node --from=web-build /app/web/dist ./web/dist

# ~/.agile-studio (dữ liệu Studio) và ~/.claude (đăng nhập) đều là volume mount lúc chạy.
# Tạo sẵn để mount không tạo nhầm thư mục thuộc root.
RUN mkdir -p /home/node/.agile-studio /home/node/.claude && chown -R node:node /home/node

USER node
ENV NODE_ENV=production \
    HOME=/home/node \
    PORT=4311 \
    HOST=0.0.0.0
EXPOSE 4311

# Cổng đã mở chưa đủ — server phải trả lời được. /api/platform là route rẻ nhất, không đụng đĩa.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4311)+'/api/platform').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
