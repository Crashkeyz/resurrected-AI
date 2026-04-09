using UnityEngine;
using System.Collections;
using System.Collections.Generic;

public class PastorZeke : MonoBehaviour
{
    [Header("Payment Settings")]
    public string myPaymentLink = "https://paypal.com";

    [Header("Crazy Street Preacher Personality")]
    public int interactionCount = 0;
    private bool isSpeaking = false;
    private bool awaitingHymnResponse = false;
    private int currentHymnIndex = -1;

    // ── Hymns Pastor Zeke sings ──────────────────────────────────────────────
    private List<string> hymnSnippets = new List<string> {
        "Jesus loves me, this I know... for the Bible tells me so...",
        "He's got the whole world in His hands... He's got the whole wide world in His hands...",
        "Amazing Grace, how sweet the sound... that saved a wretch like me...",
        "Swing low, sweet chariot... comin' for to carry me home...",
        "When the saints go marching in... oh when the saints go marching in..."
    };

    // ── Angry responses when the player says "no" ────────────────────────────
    private List<string> noResponses = new List<string> {
        "YOU GONNA DIE AND GO TO HELL! You hear me?! STRAIGHT TO HELL!",
        "The LORD shall smite thee with madness and blindness and astonishment of heart! DEUTERONOMY 28:28!",
        "And the smoke of their torment ascendeth up FOREVER AND EVER! REVELATION 14:11! That's YOU, sinner!",
        "Thou shalt be cursed in the city and cursed in the field! The LORD said it, NOT ME!",
        "The wicked shall be turned into HELL! ALL nations that forget God! PSALM 9:17!"
    };

    // ── Old Testament mutterings ─────────────────────────────────────────────
    private List<string> wickedMutterings = new List<string> {
        "*mutters* ...and the earth opened her mouth and swallowed them up... Numbers 16:32...",
        "*mutters* ...I will send wild beasts among you which shall rob you of your children... Leviticus 26:22...",
        "*mutters* ...their flesh shall consume away while they stand upon their feet... Zechariah 14:12...",
        "*mutters* ...I will make mine arrows drunk with blood... Deuteronomy 32:42...",
        "*mutters* ...and the Lord sent fiery serpents among the people and they bit the people... Numbers 21:6..."
    };

    // ── Blessing requests ────────────────────────────────────────────────────
    private List<string> blessingRequests = new List<string> {
        "BROTHER! SISTER! Can I get a BLESSING today?! Just a small blessing for a man of GOD!",
        "The LORD provides but He uses YOUR hands to do it! Bless this humble servant!",
        "A BLESSING! That's all I ask! The Good Book says give and it SHALL be given unto you!",
        "You look like someone who FEARS the Lord! How about a blessing for ol' Pastor Zeke?!"
    };

    public void OnInteract()
    {
        if (isSpeaking) return;
        interactionCount++;

        if (interactionCount < 3)
        {
            string greeting = blessingRequests[Random.Range(0, blessingRequests.Count)];
            Debug.Log("Pastor Zeke: '" + greeting + "'");
        }
        else
        {
            StartCoroutine(ThePitch());
        }
    }

    /// <summary>
    /// Called by the dialogue system when the player responds to a hymn question.
    /// Pass true if the player says "yes" they know it, false if "no".
    /// </summary>
    public void OnPlayerResponse(bool playerKnowsHymn)
    {
        if (!awaitingHymnResponse) return;
        awaitingHymnResponse = false;

        if (playerKnowsHymn)
        {
            StartCoroutine(PrayerAndPayment());
        }
        else
        {
            StartCoroutine(HellFireResponse());
        }
    }

    IEnumerator ThePitch()
    {
        isSpeaking = true;

        // Pick a random hymn to sing
        currentHymnIndex = Random.Range(0, hymnSnippets.Count);
        string hymn = hymnSnippets[currentHymnIndex];

        Debug.Log("Pastor Zeke clears his throat, throws his arms wide, and belts out at the top of his lungs...");
        yield return new WaitForSeconds(1f);

        Debug.Log("Pastor Zeke: *singing off-key* '" + hymn + "'");
        yield return new WaitForSeconds(2f);

        // Ask if they know that one
        Debug.Log("Pastor Zeke gets right in your face, eyes wild...");
        Debug.Log("Pastor Zeke: 'YOU KNOW THAT ONE?! Tell me you know that one!'");

        awaitingHymnResponse = true;
        isSpeaking = false;

        // [SYSTEM]: Dialogue system should now present YES / NO options
        Debug.Log("[SYSTEM]: Pastor Zeke awaits your answer. Do you know the hymn? [YES] [NO]");
    }

    IEnumerator PrayerAndPayment()
    {
        isSpeaking = true;

        Debug.Log("Pastor Zeke's eyes light up with holy fire...");
        yield return new WaitForSeconds(1f);

        Debug.Log("Pastor Zeke: 'HALLELUJAH! A fellow child of GOD!'");
        yield return new WaitForSeconds(1f);

        Debug.Log("Pastor Zeke grabs your hands and bows his head...");
        yield return new WaitForSeconds(1f);

        Debug.Log("Pastor Zeke: 'Dear HEAVENLY FATHER, bless this beautiful soul right here! " +
                  "Shield them from the WICKEDNESS of this world! Let your LIGHT shine upon them " +
                  "and keep the DEVIL far from their door! AMEN! AMEN! A-MEN!'");
        yield return new WaitForSeconds(2f);

        Debug.Log("Pastor Zeke: 'Now... the Good Book says the laborer is worthy of his hire... " +
                  "Luke 10:7... A small offering for the prayer, brother? Sister?'");
        yield return new WaitForSeconds(1f);

        Debug.Log("[SYSTEM]: Pastor Zeke holds out a trembling, weathered hand and slides you a crumpled note with a payment link.");

        Application.OpenURL(myPaymentLink);
        isSpeaking = false;
    }

    IEnumerator HellFireResponse()
    {
        isSpeaking = true;

        // Alternate between direct hellfire outburst and Old Testament muttering
        bool directOutburst = Random.value > 0.5f;

        if (directOutburst)
        {
            string fury = noResponses[Random.Range(0, noResponses.Count)];
            Debug.Log("Pastor Zeke's face turns BEET RED...");
            yield return new WaitForSeconds(0.5f);
            Debug.Log("Pastor Zeke: '" + fury + "'");
        }
        else
        {
            Debug.Log("Pastor Zeke's eyes go dark and distant...");
            yield return new WaitForSeconds(0.5f);

            string muttering = wickedMutterings[Random.Range(0, wickedMutterings.Count)];
            Debug.Log("Pastor Zeke: " + muttering);
            yield return new WaitForSeconds(1.5f);
            Debug.Log("Pastor Zeke: '...that's what's COMIN' for you, sinner. Mark my words.'");
        }

        yield return new WaitForSeconds(2f);

        // Even after the outburst, he still wants that blessing money
        Debug.Log("Pastor Zeke composes himself, smooths his tattered coat...");
        Debug.Log("Pastor Zeke: 'But listen... it ain't too late. A prayer from Pastor Zeke can SAVE your soul. " +
                  "Just a small blessing is all I ask...'");
        yield return new WaitForSeconds(1f);

        Debug.Log("[SYSTEM]: Pastor Zeke holds out a trembling, weathered hand and slides you a crumpled note with a payment link.");

        Application.OpenURL(myPaymentLink);
        isSpeaking = false;
    }
}
