# The host orchestrator supplies a protected, digest-pinned image reference.
# There is deliberately no default: a local build without policy must fail.
ARG FDEV001_RUNNER_IMAGE
FROM ${FDEV001_RUNNER_IMAGE}

ARG PNPM_VERSION=10.14.0
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /runner

# The protected image build context supplies this pre-populated offline store.
# No application source, environment file, credential, or test database URL is copied.
COPY --chown=node:node pnpm-store/ /pnpm/store/
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY --chown=node:node scripts/verify-feishu-dev-release-baseline.mjs /runner/verify-feishu-dev-release-baseline.mjs
USER node
