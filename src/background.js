/**
 * Service worker MV3. Único trabalho: abrir app.html numa aba normal quando
 * o ícone da extensão é clicado (ou pelo atalho _execute_action). Sem isso,
 * o manifest usaria "default_popup" e o Chrome/Edge abriria a janela ancorada
 * minúscula em vez de uma aba — daí não dá pra usar chrome.tabs.create aqui
 * dentro sem permissão "tabs": criar aba não exige permissão nenhuma, só
 * ler dados de abas de outras origens exigiria.
 */

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});
