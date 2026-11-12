# ChromeAutomate — Extensão de Automação Visual (Manifest V3)

Extensão para Google Chrome baseada nas APIs mais recentes (**Manifest V3**, `chrome.sidePanel`, `chrome.scripting`, `chrome.storage` e `chrome.tabs`) para gravar interações na tela e montar automações com blocos lógicos e de repetição.

## Como instalar no Google Chrome

1. Abra o Chrome e acesse `chrome://extensions/`.
2. Ative a chave **Modo do desenvolvedor** no canto superior direito.
3. Clique em **Carregar sem compactação** (*Load unpacked*).
4. Selecione a pasta `ChromeAutomate`.
5. Clique no ícone da extensão **ChromeAutomate** na barra do Chrome para abrir o **Painel Lateral** (*Side Panel*).

## Passo a passo: Lista separada por vírgula → Digitar → Filtrar → Checkbox

1. Abra a página onde deseja executar a automação.
2. No painel lateral, clique em **Gravar**.
3. Na página:
   - Digite um número de exemplo no campo de texto;
   - Clique no botão **Filtrar**;
   - Clique no **Checkbox** desejado.
4. Clique em **Parar Gravação** (no painel ou no aviso flutuante na tela).
5. Clique no botão **🔁 Envolver em Repetir Lista** que aparece acima dos blocos gravados.
6. No bloco **Repetir Lista**, cole sua lista de números separados por vírgula (ex.: `1001, 1002, 1003, 1004`).
7. No bloco **Digitar**, clique no chip verde **`Usar {{item}}`** para que cada número da lista seja inserido dinamicamente.
8. (Opcional) Ajuste o modo do bloco **Checklist** (`Marcar`, `Desmarcar`, `Alternar` ou `Usar variável`) ou adicione um bloco **⏱ Aguardar** caso o filtro demore para carregar.
9. Clique em **▶ Executar**.

## Blocos disponíveis

- **🔁 Repetir Lista**: percorre itens separados por `,`, `;` ou quebra de linha e disponibiliza `{{item}}` e `{{indice}}`.
- **🔄 Repetir N×**: repete um conjunto de blocos uma quantidade fixa de vezes.
- **❓ Se (Condição)**: verifica se um elemento existe/não existe, se um texto aparece na tela, se um checkbox está marcado ou compara variáveis (com suporte a `Senão`).
- **✏️ Digitar / 🖱️ Clicar / ☑️ Checklist / 📋 Selecionar**: ações gravadas na tela ou configuradas manualmente com o seletor visual **🎯**.
- **⏱ Aguardar**: pausa por milissegundos ou aguarda um elemento aparecer na página.
- **🏷️ Variável / ⏭ Pular / 🛑 Parar Loop**: controle lógico do fluxo.

