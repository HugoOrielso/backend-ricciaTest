import express from 'express';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import cors from 'cors'
const app = express();
const PORT = process.env.PORT || 3000;
dotenv.config();

app.use(express.json())
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*" }))




app.get("/", (req, res) => {
    res.status(200).json({ message: "on vercel" })
})

app.post('/api/chat', async (req, res) => {

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    const { cuoioCapelluto, densita, email, nome, personalitaRicci, porosita, spessoreCapello, sts } = req.body;
    if (!cuoioCapelluto, !densita, !email, !nome, !personalitaRicci, !porosita, !spessoreCapello, !sts) {
        res.status(400).json({ message: 'Mancano dati da inviare' });
        return;
    }

    const context = `
    Ciao, sei un assistente virtuale dell'azienda "La Ragazza Riccia".
    La riccioluta ${nome} ha capelli ${spessoreCapello}, di quantità ${densita}, un cuoio capelluto che ${cuoioCapelluto}, ha vissuto recentemente ${sts}, ha ricci ${personalitaRicci} e presenta una porosità ${porosita}.
    Scrivile una routine personalizzata di lavaggio, styling e trattamenti usando solo prodotti del brand La Ragazza Riccia, tra i seguenti:
    - Shampoo Riccia (Shampoo ideale per capelli ricci, crespi e indisciplinati. Deterge in profondità donando al cuoio capelluto una piacevole sensazione di fresco e pulito.)
    - Scrub Detossinante (Scrub detossinante e purificante. Le microsfere di silice esfoliano delicatamente il cuoio capelluto facilitando il rinnovamento cellulare.)
    - Balsamo Riccia (Balsamo ideale per capelli ricci, crespi e indisciplinati. Ricco di burri vegetali dall’azione nutriente e condizionante, particolarmente indicato per capelli secchi e disidratati)
    - Leave-in Riccia (Lozione spray formulata per proteggere, definire e condizionare il riccio. Un polimero di styling aiuta a modellare il riccio fissandone la tenuta durante l’arco della giornata.)
    - Crema 3 in 1 250ml (A capelli umidi e in sezioni, applicare la crema styling 3 in 1 e pettinare ripetutamente con la spazzola, definire e fissare con il gel. Se vuoi applicarlo come maschera, applicalo per 30 minuti e rimuovi, quindi continua con la tua routine di styling preferita.)
    - Gel Modellante 250 ml (Perfetto per lo styling, il Gel modellante a media durata di Rizos Felices sigilla il tuo riccio senza farlo risultare appesantito, secco o maltrattato.)
    - KIT I MIEI SUPERPOTERI (Il kit definitivo per ricci sani, definiti e senza stress! Con tre impacchi specifici e un calendario guidato, saprai sempre quando e come trattare i tuoi capelli per risultati visibili).
    È possibile rispondere solo a domande inerenti l'attività "La Ragazza Riccia", tutto il resto è vietato.`

    try {
        const request = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: context },
                { role: 'system', content: "Si prega di rispondere il più rapidamente possibile, ma spiegare alla persona in modo chiaro cosa deve fare, ma in modo breve. sempre iniziare la risposta come La routine WOW per *nome* della Ragazza Riccia è:, ogni racommedazione iniziala con -. utilizzando il minor numero di token" },
            ]
        })

        const reply = request.choices[0].message.content;

        return res.status(200).json({ reply });

    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Ha ocurrido un error' });
    }
});
   
export default app 
