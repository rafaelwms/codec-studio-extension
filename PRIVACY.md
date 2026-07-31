# Política de Privacidade — Codec Studio

**Última atualização:** 31 de julho de 2026
**Extensão:** Codec Studio — Base64 & JSON ⇄ Java

## Resumo

O Codec Studio **não coleta, não armazena e não transmite nenhum dado pessoal**.
Todo o processamento acontece localmente, dentro do seu navegador. A extensão não faz
nenhuma requisição de rede — nem para servidores nossos, nem para terceiros.

## Que dados a extensão trata

O único dado que a extensão processa é o **texto que você digita, cola ou solta** na
janela de conversão. Esse texto:

- é processado inteiramente na memória do seu navegador, pelo código da própria extensão;
- **nunca** é enviado para nenhum servidor;
- **nunca** é gravado em disco;
- desaparece quando você fecha a janela da extensão.

## O que é salvo no seu navegador

Apenas as suas **preferências de uso**, gravadas no `localStorage` local do navegador:

- tema escolhido (claro ou escuro);
- ferramenta ativa (Base64 ou JSON ⇄ Java);
- opções de conversão (direção, alfabeto, estilo de classe Java, nome de classe e pacote).

Esses dados nunca saem do seu computador e podem ser apagados a qualquer momento
removendo a extensão ou limpando os dados do navegador.

## Permissões

A extensão é publicada **sem nenhuma permissão** (`"permissions": []` e
`"host_permissions": []` no manifesto). Ela não tem acesso às suas abas, ao seu
histórico, aos seus cookies, aos seus downloads nem ao conteúdo de qualquer site.
Ela também não injeta nenhum script nas páginas que você visita.

## Ausência de rede, rastreamento e código remoto

- Nenhuma requisição de rede é feita. A política de segurança de conteúdo declarada no
  manifesto (`default-src 'none'; connect-src 'none'`) faz o próprio navegador bloquear
  qualquer tentativa de conexão.
- Não há analytics, telemetria, cookies, identificadores de usuário ou publicidade.
- Todo o código executado está contido no pacote da extensão. Nenhum código remoto é
  baixado ou avaliado (`eval` e `new Function` não são usados).

## Venda e compartilhamento de dados

Não coletamos dados, portanto **não vendemos, não compartilhamos e não transferimos**
dados de usuários a terceiros — para nenhuma finalidade, incluindo determinação de
crédito, publicidade ou empréstimo.

## Verificação independente

O código-fonte é público e auditável. Você pode confirmar as afirmações acima com:

```bash
grep -rE "fetch|XMLHttpRequest|WebSocket|https?://|innerHTML|eval\(" src/ styles/ app.html
```

## Alterações nesta política

Se esta política mudar, a alteração será publicada junto com uma nova versão da extensão,
com a data de atualização revisada no topo deste documento.

## Contato

Dúvidas sobre privacidade podem ser enviadas ao responsável pela publicação da extensão,
pelo endereço de e-mail informado na página da extensão na Chrome Web Store.
