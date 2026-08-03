# syntax=docker/dockerfile:1
#
# Imagem da variante "site" do Codec Studio (https://codec-studio.rafaelwms.com).
# O projeto não tem uma única dependência de runtime, então este build também
# não roda "npm install" — só copia o código e gera a página com um script Node
# puro. O resultado é servido por nginx.

# ---- build: gera dist-web/ a partir da mesma fonte da extensão ------------
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN node scripts/build-web.mjs

# ---- runtime: nginx servindo só os arquivos estáticos gerados -------------
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist-web /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost/healthz || exit 1
