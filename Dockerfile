# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY tests ./tests

RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="Owned Symphony"
LABEL org.opencontainers.image.description="Tracker-agnostic coding-agent orchestrator CLI"
LABEL org.opencontainers.image.licenses="Apache-2.0"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gnupg \
    openssh-client \
    postgresql-client \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | gpg --dearmor -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

RUN mkdir -p /config /workspaces /logs \
  && chown -R node:node /app /config /workspaces /logs

USER node

ENV NODE_ENV=production

ENTRYPOINT ["node", "/app/dist/src/cli/index.js"]
CMD ["validate", "/config/WORKFLOW.md"]
