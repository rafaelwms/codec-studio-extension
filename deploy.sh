#!/bin/bash
set -e # Para o script se der erro

REGISTRY="ghcr.io"
USERNAME="rafaelwms"
REPO_NAME="codec-studio-extension"

deploy_project() {
    local NAME=$1
    local DOCKERFILE=$2
    local FULL_TAG="${REGISTRY}/${USERNAME}/${REPO_NAME}-${NAME}:latest"
    local PACKAGE_NAME="${REPO_NAME}-${NAME}"

    echo "🚀 Buildando e Enviando: ${NAME}..."
    docker buildx build --platform linux/amd64,linux/arm64 -f "${DOCKERFILE}" -t "${FULL_TAG}" --push .

    echo "🧹 Fazendo a faxina em ${PACKAGE_NAME} (Mantendo as 5 últimas)..."

    # Busca os IDs das versões, ordena por data de criação decrescente (mais recente primeiro), pula as 5 primeiras e seleciona o resto para deletar.
    # Captura a saída apenas se a API retornar sucesso (status 0), evitando tratar JSON de erro (como 403/404) como IDs de versão.
    VERSIONS_TO_DELETE=$(
        if OUTPUT=$(gh api "orgs/${USERNAME}/packages/container/${PACKAGE_NAME}/versions" --jq 'sort_by(.created_at) | reverse | .[5:] | .[].id' 2>/dev/null); then
            echo "$OUTPUT"
        elif OUTPUT=$(gh api "user/packages/container/${PACKAGE_NAME}/versions" --jq 'sort_by(.created_at) | reverse | .[5:] | .[].id' 2>/dev/null); then
            echo "$OUTPUT"
        else
            echo ""
        fi
    )

    if [ -n "$VERSIONS_TO_DELETE" ]; then
        for VERSION_ID in $VERSIONS_TO_DELETE; do
            echo "Apagando versão antiga: $VERSION_ID"
            # Tenta apagar via endpoint de organização e de usuário, tolerando falhas
            gh api -X DELETE "orgs/${USERNAME}/packages/container/${PACKAGE_NAME}/versions/$VERSION_ID" >/dev/null 2>&1 || \
            gh api -X DELETE "user/packages/container/${PACKAGE_NAME}/versions/$VERSION_ID" >/dev/null 2>&1 || true
        done
    else
        echo "Nada para limpar ou pacote não encontrado."
    fi
    echo "✅ Concluído: ${NAME}"
}

deploy_project "web" "Dockerfile"

# =========================================================================
# Verificação de uso de disco e limpeza do cache (Prune)
# =========================================================================
echo ""
echo "🐳 Verificando o espaço usado pelo Docker..."

# O comando 'docker system df' exibe uma tabela resumida do uso de disco do Docker,
# incluindo o tamanho do 'Build Cache' em GB/MB.
docker system df
echo ""

# Solicita a confirmação do usuário para executar a limpeza do cache de build.
read -p "Deseja fazer a limpeza do cache de build do Docker agora? (s/N): " PRUNE_OPT

# Verifica se a entrada do usuário corresponde a 's' ou 'S' (expressão regular).
if [[ "$PRUNE_OPT" =~ ^[Ss]$ ]]; then
    echo "🧹 Limpando o cache de build do Docker..."
    # Executa o prune do builder. A flag -f força a execução sem um prompt extra do próprio Docker.
    docker builder prune -f
    echo "✨ Limpeza concluída!"
else
    echo "👌 Limpeza ignorada."
fi
