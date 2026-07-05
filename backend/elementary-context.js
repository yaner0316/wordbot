function cleanWord(value) {
    return String(value || '').trim().toLowerCase();
}

function hasSingleWord(context, word) {
    const key = cleanWord(word);
    if (!key) return false;
    const matches = String(context || '').toLowerCase().match(new RegExp(`\\b${key}\\b`, 'g')) || [];
    return matches.length === 1;
}

function generateElementaryTemplateContext(word, meaning) {
    const key = cleanWord(word);
    const definition = String(meaning || '').split(';')[0].trim().toLowerCase();
    if (!key) return '';

    const simpleTemplates = {
        corn: 'We ate sweet yellow corn with dinner today.',
        cheek: 'A small tear rolled down her soft cheek.',
        roll: 'Please roll the red ball across the room.',
        puppy: 'The happy puppy wagged its tail at home.',
        kitten: 'The tiny kitten slept beside the warm basket.',
        chick: 'The yellow chick followed its mother outside today.',
        climb: 'The monkey uses its hands to climb the tall tree.',
        sweater: 'I wore a warm knitted sweater on a cold day.',
        clap: 'The children clap loudly after the happy song.',
        swing: 'The playground swing moves back and forth.',
        belly: 'My belly feels full after a big dinner.',
        crayons: 'I used bright crayons to draw a happy sun.',
        chest: 'He held the toy close to his chest.',
        mud: 'The wet mud stuck to my shoes outside.',
        pepper: 'Dad added pepper to make the soup a little spicy.',
        cabbage: 'The rabbit ate fresh green cabbage in the garden.',
        lettuce: 'I put crisp lettuce leaves in my ham sandwich.',
        brocolli: 'I ate green brocolli with rice for lunch.',
        pants: 'Tom wore blue pants on his legs to school this morning.',
        eraser: 'She used an eraser to fix the pencil mark.',
        straight: 'Please draw a straight line across the page.',
        curly: 'The girl has curly hair with many little curls after her bath.',
        cow: 'The brown cow eats grass on the farm.',
        blond: 'The boy has blond hair in the picture.',
        braided: 'The girl wore braided hair in three neat strands at school today.',
        chin: 'He touched his chin while thinking about lunch.',
        foal: 'The young foal ran beside its mother today.',
        stomp: 'The child will stomp loudly during the dance.',
    };

    if (/^a young fox\.?$/.test(definition) && key === 'cub') {
        return 'The cub is a baby fox in this story.';
    }
    if (/^a young sheep\.?$/.test(definition) && key === 'lamb') {
        return 'The lamb is a baby sheep on the farm.';
    }
    if (/^a young cow or bull\.?$/.test(definition) && key === 'calf') {
        return 'The calf is a baby cow on the farm.';
    }
    const youngAnimal = definition.match(/^a young ([a-z]+)\.?$/);
    if (youngAnimal) {
        const context = `The ${key} is a baby ${youngAnimal[1]} on the farm.`;
        if (hasSingleWord(context, key)) return context;
    }

    const template = simpleTemplates[key] || '';
    return hasSingleWord(template, key) ? template : '';
}

function generateElementaryDefinition(word, meaning) {
    const key = cleanWord(word);
    if (!key) return '';
    const definitions = {
        corn: 'A yellow food that grows on a tall plant.',
        cheek: 'The soft side of your face.',
        roll: 'To move by turning over and over.',
        puppy: 'A young dog.',
        kitten: 'A young cat.',
        chick: 'A baby bird.',
        climb: 'To go up something.',
        sweater: 'Warm clothes for the top of your body.',
        clap: 'To hit your hands together to make a sound.',
        swing: 'A seat that moves back and forth.',
        belly: 'The front part of your body near your stomach.',
        crayons: 'Colored sticks used for drawing.',
        chest: 'The front part of your body above your belly.',
        mud: 'Wet dirt.',
        pepper: 'A spice that makes food taste a little hot.',
        cabbage: 'A green vegetable with many leaves.',
        brocolli: 'A green vegetable that looks like a tiny tree.',
        pants: 'Clothes that cover your legs.',
        eraser: 'A tool that removes pencil marks.',
        straight: 'Not bent or curved.',
        curly: 'Having many curls.',
        cow: 'A farm animal that gives milk.',
        blond: 'Having light yellow hair.',
        braided: 'Woven together like a rope.',
        chin: 'The part of your face under your mouth.',
        cub: 'A baby bear, fox, lion, or tiger.',
        calf: 'A baby cow.',
        lamb: 'A baby sheep.',
        foal: 'A baby horse.',
        stomp: 'To step very hard and loudly.',
    };
    const definition = definitions[key] || '';
    if (!definition) return '';
    return new RegExp(`\\b${key}\\b`, 'i').test(definition) ? '' : definition;
}
function generateElementaryDistractors(word) {
    const key = cleanWord(word);
    const distractors = {
        corn: ['rice', 'bread', 'beans'],
        cheek: ['chin', 'nose', 'ear'],
        roll: ['jump', 'kick', 'push'],
        puppy: ['kitten', 'rabbit', 'duck'],
        kitten: ['puppy', 'rabbit', 'chick'],
        chick: ['duck', 'egg', 'bird'],
        climb: ['jump', 'run', 'walk'],
        sweater: ['jacket', 'shirt', 'coat'],
        clap: ['jump', 'wave', 'smile'],
        swing: ['slide', 'jump', 'climb'],
        belly: ['back', 'chest', 'head'],
        crayons: ['pencils', 'paper', 'books'],
        chest: ['belly', 'back', 'head'],
        mud: ['sand', 'water', 'grass'],
        pepper: ['salt', 'sugar', 'butter'],
        cabbage: ['carrot', 'potato', 'corn'],
        brocolli: ['carrot', 'corn', 'potato'],
        lettuce: ['carrot', 'corn', 'potato'],
        pants: ['shirt', 'shoes', 'socks'],
        eraser: ['pencil', 'paper', 'ruler'],
        straight: ['curly', 'round', 'bent'],
        curly: ['straight', 'long', 'short'],
        cow: ['horse', 'sheep', 'goat'],
        blond: ['brown', 'black', 'red'],
        braided: ['curly', 'straight', 'short'],
        chin: ['cheek', 'nose', 'ear'],
        cub: ['foal', 'calf', 'lamb'],
        calf: ['cub', 'foal', 'lamb'],
        lamb: ['calf', 'foal', 'cub'],
        foal: ['calf', 'lamb', 'cub'],
        stomp: ['clap', 'jump', 'wave'],
    };
    return distractors[key] || [];
}
module.exports = { generateElementaryTemplateContext, generateElementaryDefinition, generateElementaryDistractors };