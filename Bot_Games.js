import { Bot, InlineKeyboard, webhookCallback } from "https://deno.land/x/grammy@v1.30.0/mod.ts";

const CARD_STICKERS = await fetch(
  "https://raw.githubusercontent.com/alan-sj/TelegramBots/main/stickers.json"
).then(res => res.json());

const bot = new Bot(Deno.env.get("BOT_TOKEN"));


const games = {}; // chat_id -> { type: "guess"|"blackjack", ... }

function createDeck() {
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const deck = [];
  suits.forEach(suit => ranks.forEach(rank => deck.push(rank + suit)));
  return deck;
}

function cardValue(card) {
  const rank = card.slice(0,-1);
  if (['J','Q','K'].includes(rank)) return 10;
  if (rank === 'A') return 11;
  return parseInt(rank);
}

function handValue(hand) {
  let total = hand.reduce((sum, c) => sum + cardValue(c), 0);
  let aces = hand.filter(c => c.slice(0,-1) === "A").length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function cardColor(card) {
  return ['♥','♦'].includes(card.slice(-1)) ? 'red' : 'black';
}

async function sendCardSticker(chatId, card) {
  const fileId = CARD_STICKERS[card];
  if (fileId) await bot.api.sendSticker(chatId, fileId);
  else await bot.api.sendMessage(chatId, `Card: ${card}`);
}

async function showHand(chatId, hand, owner="Player", hideFirst=false) {
  if (hideFirst) {
    await bot.api.sendMessage(chatId, `${owner}'s Hand: [Hidden] + ?`);
    await sendCardSticker(chatId, hand[1]);
  } else {
    await bot.api.sendMessage(chatId, `${owner}'s Hand (${handValue(hand)}):`);
    for (const c of hand) await sendCardSticker(chatId, c);
  }
}

async function endGameMenu(chatId, message, nextGameType=null) {
  const keyboard = new InlineKeyboard()
    .text("🔄 Try Again", nextGameType || "start_guess")
    .text("Choose Another Game", "choose_game")
    .text("❌ Exit", "exit");
  await bot.api.sendMessage(chatId, message, { reply_markup: keyboard });
}

bot.command("start", async ctx => {
  const keyboard = new InlineKeyboard()
    .text("Card Guess Game", "start_guess")
    .text("Blackjack", "start_blackjack");
  await ctx.reply("Choose a game to play:", { reply_markup: keyboard });
});

// ------------------ CARD GUESS GAME ------------------
async function startGuessGame(chatId) {
  const deck = createDeck().sort(() => Math.random() - 0.5);
  games[chatId] = { type: "guess", deck, round: 1, score: 0 };
  await sendNextGuess(chatId);
}

async function sendNextGuess(chatId) {
  const game = games[chatId];
  if (!game || game.type !== "guess") return;

  const round = game.round;
  let text="", keyboard=new InlineKeyboard();

  switch(round) {
    case 1:
      text = "Q1: Will the next card be Red or Black?";
      keyboard.text("Red","red").text("Black","black"); break;
    case 2:
      text = "Q2: Will the next card be Higher or Lower?";
      keyboard.text("Higher","higher").text("Lower","lower"); break;
    case 3:
      text = "Q3: Inside or Outside previous cards?";
      keyboard.text("Inside","inside").text("Outside","outside"); break;
    case 4:
      text = "Q4: Guess the suit!";
      keyboard.row({text:"♠",callback_data:"♠"}, {text:"♥",callback_data:"♥"})
              .row({text:"♦",callback_data:"♦"}, {text:"♣",callback_data:"♣"}); break;
    default:
      await endGameMenu(chatId, `Game Over! Score: ${game.score}/4`, "start_guess");
      delete games[chatId]; return;
  }

  await bot.api.sendMessage(chatId, text, { reply_markup: keyboard });
}

async function handleGuess(ctx, guess) {
  const chatId = ctx.chat.id;
  const game = games[chatId];
  if (!game || game.type !== "guess") return;

  if (!game.deck.length) {
    await endGameMenu(chatId, "Deck empty! Game over.", "start_guess");
    delete games[chatId]; return;
  }

  const nextCard = game.deck.pop();
  let correct=false, round=game.round;

  switch(round){
    case 1: if(guess===cardColor(nextCard)) correct=true; break;
    case 2:
      const prev = game.prevCard;
      if(prev){
        if((guess==="higher" && cardValue(nextCard)>cardValue(prev)) ||
           (guess==="lower" && cardValue(nextCard)<cardValue(prev))) correct=true;
      }
      break;
   case 3:
    // If this is the first card of this round, just store it
    if(!game.prevCard1) {
        game.prevCard1 = nextCard;
        correct = true; // automatically correct for the first shown card
    } 
    // If second card hasn't been set, store it too
    else if(!game.prevCard2) {
        game.prevCard2 = nextCard;
        correct = true; // still showing second card, no guess yet
    } 
    else {
        // Both previous cards exist, now the player guesses
        const val1 = cardValue(game.prevCard1);
        const val2 = cardValue(game.prevCard2);
        const low = Math.min(val1, val2);
        const high = Math.max(val1, val2);
        const nextVal = cardValue(nextCard);

        if((guess === "inside" && nextVal > low && nextVal < high) ||
           (guess === "outside" && (nextVal < low || nextVal > high))) {
            correct = true;
        }

        // Shift cards: second previous becomes first, nextCard becomes second
        game.prevCard1 = game.prevCard2;
        game.prevCard2 = nextCard;
    }
    break;
    case 4: if(guess===nextCard.slice(-1)) correct=true; break;
  }

  await sendCardSticker(chatId,nextCard);

  if(correct){
    game.score++; game.prevCard=nextCard; game.prevCard2=nextCard;
    game.round++; await ctx.reply(`Correct! Score: ${game.score}`);
    await sendNextGuess(chatId);
  }else{
    await endGameMenu(chatId, `Wrong! Game Over. Score: ${game.score}`, "start_guess");
    delete games[chatId];
  }
}

// ------------------ BLACKJACK GAME ------------------
async function startBlackjack(chatId) {
  const deck = createDeck().sort(() => Math.random() - 0.5);
  const player=[deck.pop(),deck.pop()], dealer=[deck.pop(),deck.pop()];
  games[chatId]={type:"blackjack",deck,player,dealer};
  await bot.api.sendMessage(chatId,"Blackjack Game Started!");
  await showHand(chatId, player,"Player");
  await showHand(chatId, dealer,"Dealer",true);
  const keyboard=new InlineKeyboard().text("Hit","hit").text("Stand","stand");
  await bot.api.sendMessage(chatId,"Your move:",{reply_markup:keyboard});
}

async function handleBlackjack(ctx, action){
  const chatId = ctx.chat.id;
  const game = games[chatId];
  if(!game || game.type!=="blackjack") return;

  const {deck,player,dealer}=game;

  if(action==="hit"){
    player.push(deck.pop());
    await showHand(chatId,player,"Player");
    if(handValue(player)>21){
      await endGameMenu(chatId, `Bust! You lose.`, "start_blackjack");
      delete games[chatId]; return;
    }
    await ctx.reply(" Your move:", {reply_markup:new InlineKeyboard().text("Hit","hit").text("Stand","stand")});
  }else if(action==="stand"){
    await showHand(chatId,dealer,"Dealer");
    while(handValue(dealer)<17){dealer.push(deck.pop()); await sendCardSticker(chatId,dealer[dealer.length-1]);}
    const dealerScore=handValue(dealer), playerScore=handValue(player);
    let result="";
    if(dealerScore>21 || playerScore>dealerScore) result="You win!";
    else if(dealerScore===playerScore) result="Draw!";
    else result="Dealer wins!";
    await endGameMenu(chatId, `Final Scores:\nPlayer:${playerScore}\nDealer:${dealerScore}\n\n${result}`, "start_blackjack");
    delete games[chatId];
  }
}

// ------------------ CALLBACK HANDLER ------------------
bot.on("callback_query:data", async ctx=>{
  const data=ctx.callbackQuery.data;
  const chatId=ctx.chat.id;

  if(data==="start_guess") await startGuessGame(chatId);
  else if(data==="start_blackjack") await startBlackjack(chatId);
  else if(data === "choose_game"){
    const keyboard = new InlineKeyboard()
      .text("Ride the Bus Game", "start_guess")
      .text("Blackjack", "start_blackjack");
    await ctx.reply("Choose a game to play:", { reply_markup: keyboard });
  }
  else if(data === "exit"){
    await ctx.reply("Thanks for playing!");
    delete games[chatId];
  }
  else{
    const game=games[chatId];
    if(!game){await ctx.answerCallbackQuery(); return;}

    if(game.type==="guess") await handleGuess(ctx,data);
    else if(game.type==="blackjack") await handleBlackjack(ctx,data);
  }
  await ctx.answerCallbackQuery();
});

// ------------------ Start Bot ------------------

const handleUpdate = webhookCallback(bot, "std/http");

Deno.serve(async (req) => {
  if (req.method === "POST") {
    const url = new URL(req.url);
    if (url.pathname.slice(1) === bot.token) {
      try {
        return await handleUpdate(req);
      } catch (err) {
        console.error(err);
      }
    }
  }
  return new Response();
});