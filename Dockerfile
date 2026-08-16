FROM node:22-alpine

WORKDIR /app
COPY package.json LICENSE README.md ./
COPY bin ./bin
COPY src ./src
COPY public ./public
COPY config ./config
COPY scripts ./scripts

ENV DSH_ONE_HOST=0.0.0.0 \
    DSH_ONE_PORT=3210 \
    DSH_ONE_DATA_DIR=/data \
    DSH_ONE_OPEN_BROWSER=false

VOLUME ["/data"]
EXPOSE 3210
USER node
CMD ["node", "./bin/dsh-one.mjs", "serve", "--no-open"]
