// server/bingoUtils.js

function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

function generateBingoCard(playlist, size = 16) {
  if (playlist.length < size) {
    throw new Error('Playlist does not have enough songs for the card size');
  }
  
  const shuffled = shuffleArray(playlist);
  const selected = shuffled.slice(0, size);
  
  return selected.map(song => ({
    songId: song.id,
    name: song.name,
    artist: song.artist,
    imageUrl: song.imageUrl || null,
    marked: false
  }));
}

function checkBingo(card, playedSongs) {
  const gridSize = 4; // Assuming 4x4
  const isMarked = (index) => {
    const songId = card[index].songId;
    return playedSongs.includes(songId); 
  };

  // Check rows
  for (let r = 0; r < gridSize; r++) {
    let rowBingo = true;
    for (let c = 0; c < gridSize; c++) {
      if (!isMarked(r * gridSize + c)) rowBingo = false;
    }
    if (rowBingo) return true;
  }

  // Check cols
  for (let c = 0; c < gridSize; c++) {
    let colBingo = true;
    for (let r = 0; r < gridSize; r++) {
      if (!isMarked(r * gridSize + c)) colBingo = false;
    }
    if (colBingo) return true;
  }

  // Check diagonals
  let diag1Bingo = true;
  let diag2Bingo = true;
  for (let i = 0; i < gridSize; i++) {
    if (!isMarked(i * gridSize + i)) diag1Bingo = false;
    if (!isMarked(i * gridSize + (gridSize - 1 - i))) diag2Bingo = false;
  }
  
  if (diag1Bingo || diag2Bingo) return true;

  return false;
}

module.exports = {
  generateBingoCard,
  checkBingo
};
